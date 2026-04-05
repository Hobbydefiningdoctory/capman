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
  get(key: string): Promise<CacheEntry | null>
  set(key: string, result: MatchResult): Promise<void>
  clear(): Promise<void>
  size(): Promise<number>
}

// ─── Normalize query for cache key ────────────────────────────────────────────

export function normalizeQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, ' ')
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

  async get(key: string): Promise<CacheEntry | null> {
    const entry = this.store.get(key)
    if (entry) {
      entry.hits++
      logger.debug(`Cache hit (memory): "${key}"`)
      return entry
    }
    return null
  }

  async set(key: string, result: MatchResult): Promise<void> {
    if (this.store.size >= MEMORY_CACHE_MAX) {
      const oldest = this.store.keys().next().value
      if (oldest !== undefined) this.store.delete(oldest)
      logger.debug(`Cache evicted oldest entry (max size ${MEMORY_CACHE_MAX} reached)`)
    }
    this.store.set(key, {
      query: key,
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

export class FileCache implements CacheStore {
  private filePath: string
  private store: Map<string, CacheEntry> = new Map()
  private loaded = false

  constructor(filePath = '.capman/cache.json') {
    this.filePath = path.resolve(process.cwd(), filePath)
    logger.info(`FileCache initialized — writing to: ${this.filePath}`)
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    try {
      const raw    = await fs.promises.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        this.store = new Map(Object.entries(parsed))
        logger.debug(`File cache loaded: ${this.store.size} entries`)
      } else {
        logger.warn(`File cache at ${this.filePath} contained unexpected format — starting fresh`)
      }
    } catch {
      // File doesn't exist yet — start fresh
    }
    this.loaded = true
  }

  private async save(): Promise<void> {
    try {
      const dir = path.dirname(this.filePath)
      await fs.promises.mkdir(dir, { recursive: true })
      await fs.promises.writeFile(
        this.filePath,
        JSON.stringify(Object.fromEntries(this.store), null, 2)
      )
    } catch {
      logger.warn(`Failed to save file cache to ${this.filePath}`)
    }
  }

  async get(key: string): Promise<CacheEntry | null> {
    await this.load()
    const entry = this.store.get(key)
    if (entry) {
      entry.hits++
      logger.debug(`Cache hit (file): "${key}"`)
      return entry
    }
    return null
  }

  async set(key: string, result: MatchResult): Promise<void> {
    await this.load()
    this.store.set(key, {
      query: key,
      result,
      cachedAt: new Date().toISOString(),
      hits: 0,
    })
    await this.save()
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

  async get(key: string): Promise<CacheEntry | null> {
    const memHit = await this.memory.get(key)
    if (memHit) return memHit
    const fileHit = await this.file.get(key)
    if (fileHit) {
      await this.memory.set(key, fileHit.result)
      logger.debug(`Cache promoted to memory: "${key}"`)
      return fileHit
    }
    return null
  }

  async set(key: string, result: MatchResult): Promise<void> {
    await Promise.all([
      this.memory.set(key, result),
      this.file.set(key, result),
    ])
  }

  async clear(): Promise<void> {
    await Promise.all([
      this.memory.clear(),
      this.file.clear(),
    ])
  }

  async size(): Promise<number> {
    return this.file.size()
  }
}