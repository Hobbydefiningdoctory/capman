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


// ─── Shared Learning Index ────────────────────────────────────────────────────
// Encapsulates keyword index and stats counters.
// Both FileLearningStore and MemoryLearningStore compose this instead of
// duplicating the same ~80 lines of index management logic.

class LearningIndex {
  index:        Record<string, Record<string, number>> = {}
  statsCounter: Omit<KeywordStats, 'index'> = {
    totalQueries: 0, llmQueries: 0, cacheHits: 0, outOfScope: 0,
  }

  update(entry: LearningEntry): void {
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

  subtract(entry: LearningEntry): void {
    // Shared counter decrements regardless of capabilityId
    this.statsCounter.totalQueries  = Math.max(0, this.statsCounter.totalQueries - 1)
    if (entry.resolvedVia === 'llm')   this.statsCounter.llmQueries  = Math.max(0, this.statsCounter.llmQueries  - 1)
    if (entry.resolvedVia === 'cache') this.statsCounter.cacheHits   = Math.max(0, this.statsCounter.cacheHits   - 1)
    if (!entry.capabilityId) {
      this.statsCounter.outOfScope = Math.max(0, this.statsCounter.outOfScope - 1)
      return
    }

    // Keyword index cleanup
    const words = entry.query.toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 2 && !STOPWORDS.has(w))
    for (const word of words) {
      if (!this.index[word]) continue
      this.index[word][entry.capabilityId] =
        (this.index[word][entry.capabilityId] ?? 1) - 1
      if (this.index[word][entry.capabilityId] <= 0) {
        delete this.index[word][entry.capabilityId]
      }
      if (Object.keys(this.index[word]).length === 0) {
        delete this.index[word]
      }
    }
  }

  rebuild(entries: LearningEntry[]): void {
    this.index        = {}
    this.statsCounter = { totalQueries: 0, llmQueries: 0, cacheHits: 0, outOfScope: 0 }
    for (const entry of entries) {
      this.update(entry)
    }
  }

  reset(): void {
    this.index        = {}
    this.statsCounter = { totalQueries: 0, llmQueries: 0, cacheHits: 0, outOfScope: 0 }
  }

  getStats(): KeywordStats {
    return { ...this.statsCounter, index: structuredClone(this.index) }
  }

  getIndex(): Record<string, Record<string, number>> {
    return structuredClone(this.index)
  }
}

// ─── File Learning Store ──────────────────────────────────────────────────────

export class FileLearningStore implements LearningStore {
  private filePath:   string
  private entries:    LearningEntry[] = []
  private loaded:     boolean         = false
  private saveQueue:  Promise<void>   = Promise.resolve()
  private learningIndex = new LearningIndex()
  private dirty:      boolean         = false
  private saveTimer:  ReturnType<typeof setTimeout> | null = null

  constructor(filePath = '.capman/learning.json') {
    const cwd      = process.cwd()
    const resolved = path.resolve(cwd, filePath)
    const allowedPrefix = cwd === '/' ? '/' : cwd + path.sep
    if (!resolved.startsWith(allowedPrefix)) {
      throw new Error(
        `FileLearningStore path "${filePath}" resolves outside the working directory.\n` +
        `Resolved: ${resolved}\nAllowed:  ${cwd}`
      )
    }
    this.filePath = resolved
    logger.info(`FileLearningStore initialized — writing to: ${this.filePath}`)

    // Flush on process exit — prevents losing the last N seconds of learning data
    // on graceful shutdown (SIGTERM, SIGINT) or normal process.exit().
    const flush = () => {
      if (this.dirty) {
        this.dirty = false
        // Synchronous write on exit — async is not reliable in exit handlers
        try {
          const dir = require('path').dirname(this.filePath)
          require('fs').mkdirSync(dir, { recursive: true })
          require('fs').writeFileSync(
            this.filePath,
            JSON.stringify({ entries: this.entries, updatedAt: new Date().toISOString() }, null, 2)
          )
        } catch {
          // Best-effort — can't do much in an exit handler
        }
      }
    }

    process.on('exit', flush)
    process.on('SIGTERM', () => { flush(); process.exit(0) })
    process.on('SIGINT',  () => { flush(); process.exit(0) })
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    try {
      const raw    = await fs.promises.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.entries)) {
          this.entries = parsed.entries
          this.learningIndex.rebuild(this.entries)
          logger.debug(`Learning store loaded: ${this.entries.length} entries`)
      } else {
        logger.warn(`Learning store at ${this.filePath} contained unexpected format — starting fresh`)
      }
    } catch {
      // File doesn't exist yet — start fresh
    }
    this.loaded = true
  }

  private scheduleSave(urgencyMs = 5_000): void {
    this.dirty = true
    if (!this.saveTimer) {
      this.saveTimer = setTimeout(async () => {
        this.saveTimer = null
        if (this.dirty) {
          this.dirty = false
          await this._doSave()
        }
      }, urgencyMs)
    }
  }

  private save(): Promise<void> {
    this.saveQueue = this.saveQueue.then(() => this._doSave())
    return this.saveQueue
  }

  private async _doSave(): Promise<void> {
    try {
      const dir = path.dirname(this.filePath)
      await fs.promises.mkdir(dir, { recursive: true })
      const tmp = `${this.filePath}.tmp`
      await fs.promises.writeFile(
        tmp,
        JSON.stringify({
          entries: this.entries,
          updatedAt: new Date().toISOString(),
        }, null, 2)
      )
      await fs.promises.rename(tmp, this.filePath)
    } catch (err) {
      logger.warn(`Failed to save learning store to ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async record(entry: LearningEntry): Promise<void> {
    await this.load()
    // Store only tokenized keywords — never raw query text.
    // Raw queries may contain PII (emails, names, order IDs) that should
    // not be persisted to disk under GDPR/CCPA data retention requirements.
    const sanitized: LearningEntry = {
      ...entry,
      query: entry.query
        .toLowerCase()
        .split(/\W+/)
        .filter(w => w.length > 2 && !STOPWORDS.has(w))
        .join(' '),
    }
    this.entries.push(sanitized)
    this.learningIndex.update(sanitized)

    if (this.entries.length > MAX_LEARNING_ENTRIES) {
      const excess   = this.entries.length - MAX_LEARNING_ENTRIES
      const pruned   = this.entries.splice(0, excess)
      // Subtract pruned entries from index — O(pruned × w) instead of O(n × w) full rebuild
      for (const entry of pruned) {
        this.learningIndex.subtract(entry)
      }
      logger.debug(`Learning store pruned ${excess} oldest entries (cap: ${MAX_LEARNING_ENTRIES})`)
    }
    this.scheduleSave()
  }

  async getStats(): Promise<KeywordStats> {
    await this.load()
    return this.learningIndex.getStats()
  }

  async getIndex(): Promise<Record<string, Record<string, number>>> {
    await this.load()
    return this.learningIndex.getIndex()
  }

  async getTopCapabilities(limit = 5): Promise<Array<{ id: string; hits: number }>> {
    await this.load()
    return computeTopCapabilities(this.entries, limit)
  }

  async clear(): Promise<void> {
    this.entries = []
    this.learningIndex.reset()
    await this.save()
  }
}

// ─── Memory Learning Store (for testing) ─────────────────────────────────────

  export class MemoryLearningStore implements LearningStore {
    private entries:      LearningEntry[]                        = []
    private learningIndex = new LearningIndex()

  async record(entry: LearningEntry): Promise<void> {
      const sanitized: LearningEntry = {
        ...entry,
        query: entry.query
          .toLowerCase()
          .split(/\W+/)
          .filter(w => w.length > 2 && !STOPWORDS.has(w))
          .join(' '),
      }
      this.entries.push(sanitized)
      this.learningIndex.update(sanitized)
      if (this.entries.length > MAX_LEARNING_ENTRIES) {
        const excess = this.entries.length - MAX_LEARNING_ENTRIES
        const pruned = this.entries.splice(0, excess)
        for (const entry of pruned) {
          this.learningIndex.subtract(entry)
        }
      }
    }
  
  async getStats(): Promise<KeywordStats> {
     return this.learningIndex.getStats()
    }

  async getIndex(): Promise<Record<string, Record<string, number>>> {
    return this.learningIndex.getIndex()
    }

  async getTopCapabilities(limit = 5): Promise<Array<{ id: string; hits: number }>> {
    return computeTopCapabilities(this.entries, limit)
  }

  async clear(): Promise<void> {
    this.entries = []
    this.learningIndex.reset()
  }
}




