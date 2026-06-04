import * as fs from 'fs'
import * as path from 'path'
import type { MatchResult } from './types'
import { logger } from './logger'

// ─── Cache Entry ──────────────────────────────────────────────────────────────

export interface CacheEntry {
  query: string
  result: MatchResult
  cachedAt: string
  hits: number
}

// ─── Cache Interface ──────────────────────────────────────────────────────────

export interface CacheStore {
  get(key: string, ttlMs?: number): Promise<CacheEntry | null>
  set(key: string, result: MatchResult, originalQuery?: string): Promise<void>
  clear(): Promise<void>
  size(): Promise<number>
}

// ─── Normalize query for cache key ────────────────────────────────────────────

export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, '')   // Unicode-aware: preserves Japanese, Arabic, accented Latin etc.
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Build a smarter cache key based on matched capability + extracted params.
 * Two different queries that resolve to the same capability with the same params
 * will share a cache entry — dramatically improving hit rate.
 * Falls back to normalized query if no capability matched.
 */

export function buildCacheKey(
  query: string,
  capabilityId: string | null,
  extractedParams: Record<string, string | null>
): string {
  if (!capabilityId) return `query:${normalizeQuery(query)}`
  const paramStr = Object.entries(extractedParams)
    .filter(([, v]) => v !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  return `cap:${capabilityId}${paramStr ? `:${paramStr}` : ''}`
}

// ─── Memory Cache ─────────────────────────────────────────────────────────────

const MEMORY_CACHE_MAX = 512


export class MemoryCache implements CacheStore {
  private store = new Map<string, CacheEntry>()

  async get(key: string, ttlMs?: number): Promise<CacheEntry | null> {
    const entry = this.store.get(key)
    if (entry) {
      if (ttlMs && Date.now() - new Date(entry.cachedAt).getTime() > ttlMs) {
        this.store.delete(key)
        logger.debug(`Cache entry expired (memory): "${key}"`)
        return null
      }
      entry.hits++
      this.store.delete(key)
      this.store.set(key, entry)
      logger.debug(`Cache hit (memory): "${key}"`)
      return entry
    }
    return null
  }

  async set(key: string, result: MatchResult, originalQuery?: string): Promise<void> {
    if (this.store.size >= MEMORY_CACHE_MAX) {
      const oldest = this.store.keys().next().value
      if (oldest !== undefined) this.store.delete(oldest)
      logger.debug(`Cache evicted oldest entry (max size ${MEMORY_CACHE_MAX} reached)`)
    }
    this.store.set(key, {
      query: originalQuery ?? key,
      result,
      cachedAt: new Date().toISOString(),
      hits: 0,
    })
    logger.debug(`Cache set (memory): "${key}"`)
  }

  async clear(): Promise<void> { this.store.clear() }
  async size(): Promise<number> { return this.store.size }
}

// ─── File Cache ───────────────────────────────────────────────────────────────

const FILE_CACHE_MAX = 2048

export class FileCache implements CacheStore {
  private filePath:    string
  private store:       Map<string, CacheEntry> = new Map()
  private loadPromise: Promise<void> | null    = null
  private saveQueue:   Promise<void>           = Promise.resolve()
  private dirty:       boolean                 = false
  private saveTimer:   ReturnType<typeof setTimeout> | null = null

  constructor(filePath = '.capman/cache.json') {
    const cwd      = process.cwd()
    const resolved = path.resolve(cwd, filePath)
    const allowedPrefix = cwd === '/' ? '/' : cwd + path.sep
    if (!resolved.startsWith(allowedPrefix)) {
      throw new Error(
        `FileCache path "${filePath}" resolves outside the working directory.\n` +
        `Resolved: ${resolved}\nAllowed:  ${cwd}`
      )
    }
    this.filePath = resolved
    logger.info(`FileCache initialized — writing to: ${this.filePath}`)
  }

      private load(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this._doLoad().catch(err => {
        this.loadPromise = null  // allow retry on next call
        throw err
      })
    }
    return this.loadPromise
  }

      private async _doLoad(): Promise<void> {
        try {
      const raw    = await fs.promises.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // Normalize keys on load — prevents duplicate entries from older versions,
        // manual edits, or any path that bypassed normalizeQuery() on write.
        // e.g. "Show me articles" and "show me articles" collapse to the same key.
        const normalized = new Map<string, CacheEntry>()
        for (const [k, v] of Object.entries(parsed)) {
          // Validate entry structure before accepting — a corrupted entry
          // (null result, missing cachedAt) would cause runtime errors deep
          // in the engine when capability fields are accessed.
          if (
            v !== null && typeof v === 'object' &&
            'result' in (v as object) && (v as CacheEntry).result !== null &&
            typeof (v as CacheEntry).cachedAt === 'string'
          ) {
            const storeKey = (k.startsWith('cap:') || k.startsWith('query:'))
              ? k
              : normalizeQuery(k)
            normalized.set(storeKey, v as CacheEntry)
          } else {
            logger.warn(`File cache: skipping invalid entry for key "${k}"`)
          }
        }
        this.store = normalized
        logger.debug(`File cache loaded: ${this.store.size} entries`)
      } else {
        logger.warn(`File cache at ${this.filePath} contained unexpected format — starting fresh`)
      }
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code
          if (code !== 'ENOENT') {
            logger.warn(`Failed to load file cache from ${this.filePath} (${code ?? 'unknown error'}) — starting fresh`)
          }
          // ENOENT = file doesn't exist yet — expected on first run, no warning needed
        }
  }

  private save(): Promise<void> {
    this.saveQueue = this.saveQueue.then(() => this._doSave())
    return this.saveQueue
  }

  /**
   * Debounced save — batches evictions and rapid writes into a single disk flush.
   * Prevents a flurry of full-file writes when many TTL-expired entries are read
   * in quick succession (e.g. after a server restart with a stale cache file).
   * Mirrors the scheduleSave() pattern in FileLearningStore.
   */
  private scheduleSave(urgencyMs = 5_000): void {
    this.dirty = true
    if (!this.saveTimer) {
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null
        if (this.dirty) {
          this.dirty = false
          this.save()
        }
      }, urgencyMs)
    }
  }

  private async _doSave(): Promise<void> {
    try {
      const dir = path.dirname(this.filePath)
      await fs.promises.mkdir(dir, { recursive: true })
      const tmp = `${this.filePath}.tmp`
      await fs.promises.writeFile(tmp, JSON.stringify(Object.fromEntries(this.store), null, 2))
      await fs.promises.rename(tmp, this.filePath)
    } catch (err) {
      logger.warn(`Failed to save file cache to ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async get(key: string, ttlMs?: number): Promise<CacheEntry | null> {
    await this.load()
    const entry = this.store.get(key)
    if (!entry) return null

    if (ttlMs && Date.now() - new Date(entry.cachedAt).getTime() > ttlMs) {
      this.store.delete(key)
      // Batch the eviction write — immediate save() on every expired read causes
      // a full file rewrite per request during cold-start with a stale cache.
      this.scheduleSave()
      logger.debug(`Cache entry expired (file): "${key}"`)
      return null
    }

    entry.hits++
    this.store.delete(key)    // reinsert at end for LRU ordering
    this.store.set(key, entry)
    // hits counter is in-memory only — not saved on read
    // saves only happen on set() and eviction to avoid full file rewrite per request
    logger.debug(`Cache hit (file): "${key}"`)
    return entry
  }

     async set(key: string, result: MatchResult, originalQuery?: string): Promise<void> {
    await this.load()
    if (this.store.size >= FILE_CACHE_MAX) {
      const oldest = this.store.keys().next().value
      if (oldest !== undefined) {
        this.store.delete(oldest)
        logger.debug(`File cache evicted oldest entry (max size ${FILE_CACHE_MAX} reached)`)
      }
    }
    this.store.set(key, {
      query: originalQuery ?? key,
      result,
      cachedAt: new Date().toISOString(),
      hits: 0,
    })
    this.scheduleSave()
    logger.debug(`Cache set (file): "${key}"`)
  }

  async clear(): Promise<void> {
    this.store.clear()
    await this.save()
  }

  async size(): Promise<number> {
    await this.load()
    return this.store.size
  }
}

// ─── Combo Cache (memory first, file fallback) ────────────────────────────────

export class ComboCache implements CacheStore {
  private memory: MemoryCache
  private file: FileCache

  constructor(filePath = '.capman/cache.json') {
    this.memory = new MemoryCache()
    this.file   = new FileCache(filePath)
  }

  async get(key: string, ttlMs?: number): Promise<CacheEntry | null> {
    const memHit = await this.memory.get(key, ttlMs)
    if (memHit) return memHit

    const fileHit = await this.file.get(key, ttlMs)
    if (fileHit) {
      await this.memory.set(key, fileHit.result)
      return fileHit
    }
    return null
  }

  async set(key: string, result: MatchResult, originalQuery?: string): Promise<void> {
    await Promise.all([
      this.memory.set(key, result, originalQuery),
      this.file.set(key, result, originalQuery),
    ])
  }

  async clear(): Promise<void> {
    await Promise.all([
      this.memory.clear(),
      this.file.clear(),
    ])
  }

  /** Returns the file-side entry count, not total unique entries across both stores.
   *  Memory may have additional promoted entries not reflected here. */
  async size(): Promise<number> {
    return this.file.size()
  }
}