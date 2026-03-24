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
  }

  private load(): void {
    if (this.loaded) return
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
        this.store = new Map(Object.entries(raw))
        logger.debug(`File cache loaded: ${this.store.size} entries`)
      }
    } catch {
      logger.warn(`Failed to load file cache at ${this.filePath}`)
    }
    this.loaded = true
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const obj = Object.fromEntries(this.store)
      fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2))
    } catch {
      logger.warn(`Failed to save file cache to ${this.filePath}`)
    }
  }

  async get(query: string): Promise<CacheEntry | null> {
    this.load()
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
    this.load()
    const key = normalizeQuery(query)
    this.store.set(key, {
      query,
      result,
      cachedAt: new Date().toISOString(),
      hits: 0,
    })
    this.save()
    logger.debug(`Cache set (file): "${query}"`)
  }

  async clear(): Promise<void> {
    this.store.clear()
    this.save()
  }

  async size(): Promise<number> {
    this.load()
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