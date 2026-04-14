import * as fs from 'fs'
import * as path from 'path'
import type { MatchResult } from './types'
import { logger } from './logger'
const MAX_LEARNING_ENTRIES = 10_000
import { STOPWORDS } from './matcher'

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
  /** Returns the live keyword index without rebuilding — O(1) */
  getIndex(): Promise<Record<string, Record<string, number>>>
}

// ─── Shared computation helpers ───────────────────────────────────────────────

function computeStats(entries: LearningEntry[]): KeywordStats {
  const index: Record<string, Record<string, number>> = {}
  let totalQueries = 0
  let llmQueries   = 0
  let cacheHits    = 0
  let outOfScope   = 0

  for (const entry of entries) {
    totalQueries++
    if (entry.resolvedVia === 'llm')   llmQueries++
    if (entry.resolvedVia === 'cache') cacheHits++
    if (!entry.capabilityId)           outOfScope++

    if (entry.capabilityId) {
      const words = entry.query.toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 2 && !STOPWORDS.has(w))

      for (const word of words) {
        if (!index[word]) index[word] = {}
        index[word][entry.capabilityId] =
          (index[word][entry.capabilityId] ?? 0) + 1
      }
    }
  }

  return { index, totalQueries, llmQueries, cacheHits, outOfScope }
}

function computeTopCapabilities(
  entries: LearningEntry[],
  limit: number
): Array<{ id: string; hits: number }> {
  const counts: Record<string, number> = {}
  for (const entry of entries) {
    if (entry.capabilityId) {
      counts[entry.capabilityId] = (counts[entry.capabilityId] ?? 0) + 1
    }
  }
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([id, hits]) => ({ id, hits }))
}

// ─── File Learning Store ──────────────────────────────────────────────────────

export class FileLearningStore implements LearningStore {
  private filePath: string
  private entries:  LearningEntry[] = []
  private loaded:   boolean         = false

  // ── Incremental index — updated in record(), not rebuilt in getStats() ────
  private index:        Record<string, Record<string, number>> = {}
  private statsCounter: Omit<KeywordStats, 'index'> = {
    totalQueries: 0, llmQueries: 0, cacheHits: 0, outOfScope: 0,
  }

  constructor(filePath = '.capman/learning.json') {
    this.filePath = path.resolve(process.cwd(), filePath)
    logger.info(`FileLearningStore initialized — writing to: ${this.filePath}`)
  }

  private updateIndex(entry: LearningEntry): void {
    this.statsCounter.totalQueries++
    if (entry.resolvedVia === 'llm')   this.statsCounter.llmQueries++
    if (entry.resolvedVia === 'cache') this.statsCounter.cacheHits++
    if (!entry.capabilityId)           this.statsCounter.outOfScope++

    if (entry.capabilityId) {
      const words = entry.query.toLowerCase()
        .split(/\W+/)
        .filter(w => w.length > 2 && !STOPWORDS.has(w))
      for (const word of words) {
        this.index[word] ??= {}
        this.index[word][entry.capabilityId] =
          (this.index[word][entry.capabilityId] ?? 0) + 1
      }
    }
  }

  private rebuildIndex(): void {
    this.index        = {}
    this.statsCounter = { totalQueries: 0, llmQueries: 0, cacheHits: 0, outOfScope: 0 }
    for (const entry of this.entries) {
      this.updateIndex(entry)
    }
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    try {
      const raw    = await fs.promises.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.entries)) {
          this.entries = parsed.entries
          this.rebuildIndex()
          logger.debug(`Learning store loaded: ${this.entries.length} entries`)
      } else {
        logger.warn(`Learning store at ${this.filePath} contained unexpected format — starting fresh`)
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
        JSON.stringify({
          entries: this.entries,
          updatedAt: new Date().toISOString(),
        }, null, 2)
      )
    } catch {
      logger.warn(`Failed to save learning store to ${this.filePath}`)
    }
  }

  async record(entry: LearningEntry): Promise<void> {
    await this.load()
    this.entries.push(entry)
    this.updateIndex(entry)

    if (this.entries.length > MAX_LEARNING_ENTRIES) {
      const excess = this.entries.length - MAX_LEARNING_ENTRIES
      this.entries.splice(0, excess)
      // Rebuild index after pruning — pruned entries may have affected counts
      this.rebuildIndex()
      logger.debug(`Learning store pruned ${excess} oldest entries (cap: ${MAX_LEARNING_ENTRIES})`)
    }
    await this.save()
  }

  async getStats(): Promise<KeywordStats> {
    await this.load()
    return { ...this.statsCounter, index: this.index }
  }

  async getIndex(): Promise<Record<string, Record<string, number>>> {
    await this.load()
    return this.index
  }

  async getTopCapabilities(limit = 5): Promise<Array<{ id: string; hits: number }>> {
    await this.load()
    return computeTopCapabilities(this.entries, limit)
  }

  async clear(): Promise<void> {
    this.entries = []
    await this.save()
  }
}

// ─── Memory Learning Store (for testing) ─────────────────────────────────────

  export class MemoryLearningStore implements LearningStore {
    private entries:      LearningEntry[]                        = []
    private index:        Record<string, Record<string, number>> = {}
    private statsCounter: Omit<KeywordStats, 'index'>            = {
      totalQueries: 0, llmQueries: 0, cacheHits: 0, outOfScope: 0,
    }

    async record(entry: LearningEntry): Promise<void> {
      this.entries.push(entry)
      this.updateIndex(entry)
      if (this.entries.length > MAX_LEARNING_ENTRIES) {
        this.entries.splice(0, this.entries.length - MAX_LEARNING_ENTRIES)
        this.rebuildIndex()
      }
    }
  
    async getStats(): Promise<KeywordStats> {
      return { ...this.statsCounter, index: this.index }
    }

    async getIndex(): Promise<Record<string, Record<string, number>>> {
      return this.index
    }

    private updateIndex(entry: LearningEntry): void {
      this.statsCounter.totalQueries++
      if (entry.resolvedVia === 'llm')   this.statsCounter.llmQueries++
      if (entry.resolvedVia === 'cache') this.statsCounter.cacheHits++
      if (!entry.capabilityId)           this.statsCounter.outOfScope++

      if (entry.capabilityId) {
        const words = entry.query.toLowerCase()
          .split(/\W+/)
          .filter(w => w.length > 2 && !STOPWORDS.has(w))
        for (const word of words) {
          this.index[word] ??= {}
          this.index[word][entry.capabilityId] =
            (this.index[word][entry.capabilityId] ?? 0) + 1
        }
      }
    }

    private rebuildIndex(): void {
      this.index        = {}
      this.statsCounter = { totalQueries: 0, llmQueries: 0, cacheHits: 0, outOfScope: 0 }
      for (const entry of this.entries) {
        this.updateIndex(entry)
      }
    }

  async getTopCapabilities(limit = 5): Promise<Array<{ id: string; hits: number }>> {
    return computeTopCapabilities(this.entries, limit)
  }

  async clear(): Promise<void> {
    this.entries = []
  }
}




