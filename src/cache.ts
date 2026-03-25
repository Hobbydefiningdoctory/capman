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
  get(query: string): Promise<CacheEntry | null>
  set(query: string, result: MatchResult): Promise<void>
  clear(): Promise<void>
  size(): Promise<number>
}

// ─── Normalize query for cache key ────────────────────────────────────────────

function normalizeQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, ' ')
}

// ─── Memory Cache ─────────────────────────────────────────────────────────────

export class MemoryCache implements CacheStore {
  private store = new Map<string, CacheEntry>()

  async get(query: string): Promise<CacheEntry | null> {
    const key = normalizeQuery(query)
    const entry = this.store.get(key)
    if (entry) {
      entry.hits++
      logger.debug(`Cache hit (memory): "${query}"`)
      return entry
    }
    return null
  }

  async set(query: string, result: MatchResult): Promise<void> {
    const key = normalizeQuery(query)
    this.store.set(key, {
      query,
      result,
      cachedAt: new Date().toISOString(),
      hits: 0,
    })
    logger.debug(`Cache set (memory): "${query}"`)
  }

  async clear(): Promise<void> {
    this.store.clear()
  }

  async size(): Promise<number> {
    return this.store.size
  }
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
      const raw = await fs.promises.readFile(this.filePath, 'utf-8')
      this.store = new Map(Object.entries(JSON.parse(raw)))
      logger.debug(`File cache loaded: ${this.store.size} entries`)
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

  async get(query: string): Promise<CacheEntry | null> {
    await this.load()
    const key = normalizeQuery(query)
    const entry = this.store.get(key)
    if (entry) {
      entry.hits++
      logger.debug(`Cache hit (file): "${query}"`)
      return entry
    }
    return null
  }

  async set(query: string, result: MatchResult): Promise<void> {
    await this.load()
    const key = normalizeQuery(query)
    this.store.set(key, {
      query,
      result,
      cachedAt: new Date().toISOString(),
      hits: 0,
    })
    await this.save()
    logger.debug(`Cache set (file): "${query}"`)
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

  async get(query: string): Promise<CacheEntry | null> {
    // Memory first — fastest
    const memHit = await this.memory.get(query)
    if (memHit) return memHit

    // File fallback — persists across restarts
    const fileHit = await this.file.get(query)
    if (fileHit) {
      // Promote to memory for next time
      await this.memory.set(query, fileHit.result)
      logger.debug(`Cache promoted to memory: "${query}"`)
      return fileHit
    }

    return null
  }

  async set(query: string, result: MatchResult): Promise<void> {
    await Promise.all([
      this.memory.set(query, result),
      this.file.set(query, result),
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