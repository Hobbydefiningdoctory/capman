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
  clear(): Promise<void>
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
  private entries: LearningEntry[] = []
  private loaded = false

  constructor(filePath = '.capman/learning.json') {
    this.filePath = path.resolve(process.cwd(), filePath)
    logger.info(`FileLearningStore initialized — writing to: ${this.filePath}`)
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    try {
      const raw    = await fs.promises.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.entries)) {
        this.entries = parsed.entries
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

    // Prune oldest entries if over cap
    if (this.entries.length > MAX_LEARNING_ENTRIES) {
      const excess = this.entries.length - MAX_LEARNING_ENTRIES
      this.entries.splice(0, excess)
      logger.debug(`Learning store pruned ${excess} oldest entries (cap: ${MAX_LEARNING_ENTRIES})`)
    }

    await this.save()
    logger.debug(`Learning recorded: "${entry.query}" → ${entry.capabilityId ?? 'OUT_OF_SCOPE'} via ${entry.resolvedVia}`)
  }

  async getStats(): Promise<KeywordStats> {
    await this.load()
    return computeStats(this.entries)
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
  private entries: LearningEntry[] = []

  async record(entry: LearningEntry): Promise<void> {
    this.entries.push(entry)
    if (this.entries.length > MAX_LEARNING_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_LEARNING_ENTRIES)
    }
  }
  
  async getStats(): Promise<KeywordStats> {
    return computeStats(this.entries)
  }

  async getTopCapabilities(limit = 5): Promise<Array<{ id: string; hits: number }>> {
    return computeTopCapabilities(this.entries, limit)
  }

  async clear(): Promise<void> {
    this.entries = []
  }
}




