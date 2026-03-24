import * as fs from 'fs'
import * as path from 'path'
import type { MatchResult } from './types'
import { logger } from './logger'

// ─── Learning Entry ───────────────────────────────────────────────────────────

export interface LearningEntry {
  query: string
  capabilityId: string | null
  confidence: number
  intent: string
  extractedParams: Record<string, string | null>
  resolvedVia: 'keyword' | 'llm' | 'cache'
  timestamp: string
}

// ─── Keyword Stats ────────────────────────────────────────────────────────────

export interface KeywordStats {
  /** keyword → Map of capabilityId → hit count */
  index: Record<string, Record<string, number>>
  /** Total queries processed */
  totalQueries: number
  /** Queries that went to LLM */
  llmQueries: number
  /** Queries served from cache */
  cacheHits: number
  /** Out of scope queries */
  outOfScope: number
}

// ─── Learning Store Interface ─────────────────────────────────────────────────

export interface LearningStore {
  record(entry: LearningEntry): Promise<void>
  getStats(): Promise<KeywordStats>
  getTopCapabilities(limit?: number): Promise<Array<{ id: string; hits: number }>>
  clear(): Promise<void>
}

// ─── File Learning Store ──────────────────────────────────────────────────────

export class FileLearningStore implements LearningStore {
  private filePath: string
  private entries: LearningEntry[] = []
  private loaded = false

  constructor(filePath = '.capman/learning.json') {
    this.filePath = path.resolve(process.cwd(), filePath)
  }

  private load(): void {
    if (this.loaded) return
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
        this.entries = raw.entries ?? []
        logger.debug(`Learning store loaded: ${this.entries.length} entries`)
      }
    } catch {
      logger.warn(`Failed to load learning store at ${this.filePath}`)
    }
    this.loaded = true
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(this.filePath, JSON.stringify({
        entries: this.entries,
        updatedAt: new Date().toISOString(),
      }, null, 2))
    } catch {
      logger.warn(`Failed to save learning store to ${this.filePath}`)
    }
  }

  async record(entry: LearningEntry): Promise<void> {
    this.load()
    this.entries.push(entry)
    this.save()
    logger.debug(`Learning recorded: "${entry.query}" → ${entry.capabilityId ?? 'OUT_OF_SCOPE'} via ${entry.resolvedVia}`)
  }

  async getStats(): Promise<KeywordStats> {
    this.load()

    const index: Record<string, Record<string, number>> = {}
    let totalQueries = 0
    let llmQueries   = 0
    let cacheHits    = 0
    let outOfScope   = 0

    for (const entry of this.entries) {
      totalQueries++
      if (entry.resolvedVia === 'llm')   llmQueries++
      if (entry.resolvedVia === 'cache') cacheHits++
      if (!entry.capabilityId)           outOfScope++

      if (entry.capabilityId) {
        // Index each word of the query against the matched capability
        const words = entry.query.toLowerCase()
          .split(/\W+/)
          .filter(w => w.length > 2)

        for (const word of words) {
          if (!index[word]) index[word] = {}
          index[word][entry.capabilityId] =
            (index[word][entry.capabilityId] ?? 0) + 1
        }
      }
    }

    return { index, totalQueries, llmQueries, cacheHits, outOfScope }
  }

  async getTopCapabilities(limit = 5): Promise<Array<{ id: string; hits: number }>> {
    this.load()
    const counts: Record<string, number> = {}

    for (const entry of this.entries) {
      if (entry.capabilityId) {
        counts[entry.capabilityId] = (counts[entry.capabilityId] ?? 0) + 1
      }
    }

    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([id, hits]) => ({ id, hits }))
  }

  async clear(): Promise<void> {
    this.entries = []
    this.save()
  }
}

// ─── Memory Learning Store (for testing) ─────────────────────────────────────

export class MemoryLearningStore implements LearningStore {
  private entries: LearningEntry[] = []

  async record(entry: LearningEntry): Promise<void> {
    this.entries.push(entry)
  }

  async getStats(): Promise<KeywordStats> {
    const index: Record<string, Record<string, number>> = {}
    let totalQueries = 0
    let llmQueries   = 0
    let cacheHits    = 0
    let outOfScope   = 0

    for (const entry of this.entries) {
      totalQueries++
      if (entry.resolvedVia === 'llm')   llmQueries++
      if (entry.resolvedVia === 'cache') cacheHits++
      if (!entry.capabilityId)           outOfScope++

      if (entry.capabilityId) {
        const words = entry.query.toLowerCase()
          .split(/\W+/)
          .filter(w => w.length > 2)

        for (const word of words) {
          if (!index[word]) index[word] = {}
          index[word][entry.capabilityId] =
            (index[word][entry.capabilityId] ?? 0) + 1
        }
      }
    }

    return { index, totalQueries, llmQueries, cacheHits, outOfScope }
  }

  async getTopCapabilities(limit = 5): Promise<Array<{ id: string; hits: number }>> {
    const counts: Record<string, number> = {}
    for (const entry of this.entries) {
      if (entry.capabilityId) {
        counts[entry.capabilityId] = (counts[entry.capabilityId] ?? 0) + 1
      }
    }
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([id, hits]) => ({ id, hits }))
  }

  async clear(): Promise<void> {
    this.entries = []
  }
}