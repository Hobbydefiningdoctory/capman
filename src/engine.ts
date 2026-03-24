import type { Manifest, MatchResult, ResolveResult } from './types'
import type { LLMMatcherOptions } from './matcher'
import type { ResolveOptions, AuthContext } from './resolver'
import type { CacheStore } from './cache'
import type { LearningStore, LearningEntry } from './learning'
import { match as _match, matchWithLLM as _matchWithLLM } from './matcher'
import { resolve as _resolve } from './resolver'
import { ComboCache } from './cache'
import { FileLearningStore } from './learning'
import { logger } from './logger'
import type { MatchMode } from './index'

// ─── Engine Options ───────────────────────────────────────────────────────────

export interface EngineOptions {
  /** The capability manifest to use */
  manifest: Manifest
  /**
   * Matching mode
   * - 'cheap'    — keyword only, no LLM
   * - 'balanced' — keyword first, LLM fallback (default)
   * - 'accurate' — LLM first, keyword fallback
   */
  mode?: MatchMode
  /** LLM function for accurate/balanced matching */
  llm?: LLMMatcherOptions['llm']
  /** Cache store — defaults to ComboCache (memory + file) */
  cache?: CacheStore | false
  /** Learning store — defaults to FileLearningStore */
  learning?: LearningStore | false
  /** Base URL for API resolvers */
  baseUrl?: string
  /** Auth context for privacy-scoped capabilities */
  auth?: AuthContext
  /** Custom headers for API calls */
  headers?: Record<string, string>
  /** Confidence threshold for keyword matcher (default: 50) */
  threshold?: number
}

// ─── Engine Result ────────────────────────────────────────────────────────────

export interface EngineResult {
  match: MatchResult
  resolution: ResolveResult
  /** How the match was resolved */
  resolvedVia: 'cache' | 'keyword' | 'llm'
  /** Total time in milliseconds */
  durationMs: number
}

// ─── CapmanEngine ─────────────────────────────────────────────────────────────

export class CapmanEngine {
  private manifest:  Manifest
  private mode:      MatchMode
  private llm?:      LLMMatcherOptions['llm']
  private cache:     CacheStore | null
  private learning:  LearningStore | null
  private baseUrl?:  string
  private auth?:     AuthContext
  private headers?:  Record<string, string>
  private threshold: number

  constructor(options: EngineOptions) {
    this.manifest  = options.manifest
    this.mode      = options.mode ?? 'balanced'
    this.llm       = options.llm
    this.baseUrl   = options.baseUrl
    this.auth      = options.auth
    this.headers   = options.headers
    this.threshold = options.threshold ?? 50

    // Cache — default ComboCache, or disabled with false
    this.cache = options.cache === false
      ? null
      : (options.cache ?? new ComboCache())

    // Learning — default FileLearningStore, or disabled with false
    this.learning = options.learning === false
      ? null
      : (options.learning ?? new FileLearningStore())

    logger.info(`CapmanEngine initialized — mode: ${this.mode}, cache: ${this.cache ? 'enabled' : 'disabled'}, learning: ${this.learning ? 'enabled' : 'disabled'}`)
  }

  /**
   * Ask the engine a natural language query.
   * Automatically handles caching, matching, resolution, and learning.
   *
   * @example
   * const engine = new CapmanEngine({ manifest, llm: myLLM })
   * const result = await engine.ask("Check availability for blue jacket")
   * console.log(result.match.capability?.id)  // check_product_availability
   * console.log(result.resolution.apiCalls)   // [{ url: '...', method: 'GET' }]
   * console.log(result.resolvedVia)           // 'keyword' | 'llm' | 'cache'
   */
  async ask(query: string, overrides: Partial<ResolveOptions> = {}): Promise<EngineResult> {
    const start = Date.now()

    // ── Step 1: Check cache ──────────────────────────────────────────────────
    if (this.cache) {
      const cached = await this.cache.get(query)
      if (cached) {
        logger.info(`Cache hit for: "${query}"`)
        const resolution = await _resolve(
          cached.result,
          cached.result.extractedParams as Record<string, unknown>,
          this.resolveOptions(overrides)
        )
        const result: EngineResult = {
          match: cached.result,
          resolution,
          resolvedVia: 'cache',
          durationMs: Date.now() - start,
        }
        await this.recordLearning(query, cached.result, 'cache')
        return result
      }
    }

    // ── Step 2: Match ────────────────────────────────────────────────────────
    let matchResult: MatchResult
    let resolvedVia: EngineResult['resolvedVia'] = 'keyword'

    switch (this.mode) {
      case 'cheap': {
        matchResult = _match(query, this.manifest)
        break
      }

      case 'accurate': {
        if (this.llm) {
          matchResult  = await _matchWithLLM(query, this.manifest, { llm: this.llm })
          resolvedVia  = 'llm'
        } else {
          logger.warn('accurate mode requires llm — falling back to keyword')
          matchResult = _match(query, this.manifest)
        }
        break
      }

      case 'balanced':
      default: {
        const keywordResult = _match(query, this.manifest)
        if (keywordResult.confidence >= this.threshold || !this.llm) {
          matchResult = keywordResult
        } else {
          logger.info(`Low confidence (${keywordResult.confidence}%) — escalating to LLM`)
          matchResult = await _matchWithLLM(query, this.manifest, { llm: this.llm })
          resolvedVia = 'llm'
        }
        break
      }
    }

    // ── Step 3: Cache the match result ───────────────────────────────────────
    if (this.cache && matchResult.capability) {
      await this.cache.set(query, matchResult)
    }

    // ── Step 4: Resolve ──────────────────────────────────────────────────────
    const resolution = await _resolve(
      matchResult,
      matchResult.extractedParams as Record<string, unknown>,
      this.resolveOptions(overrides)
    )

    // ── Step 5: Record learning ──────────────────────────────────────────────
    await this.recordLearning(query, matchResult, resolvedVia)

    return {
      match: matchResult,
      resolution,
      resolvedVia,
      durationMs: Date.now() - start,
    }
  }

  /**
   * Get stats from the learning store.
   * Shows which capabilities are most used, LLM vs keyword ratio, cache hit rate.
   */
  async getStats() {
    if (!this.learning) return null
    return this.learning.getStats()
  }

  /**
   * Get the most frequently matched capabilities.
   */
  async getTopCapabilities(limit = 5) {
    if (!this.learning) return []
    return this.learning.getTopCapabilities(limit)
  }

  /**
   * Clear the cache.
   */
  async clearCache() {
    if (this.cache) await this.cache.clear()
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private resolveOptions(overrides: Partial<ResolveOptions> = {}): ResolveOptions {
    return {
      baseUrl: this.baseUrl,
      auth:    this.auth,
      headers: this.headers,
      ...overrides,
    }
  }

  private async recordLearning(
    query: string,
    matchResult: MatchResult,
    resolvedVia: LearningEntry['resolvedVia']
  ): Promise<void> {
    if (!this.learning) return
    await this.learning.record({
      query,
      capabilityId:    matchResult.capability?.id ?? null,
      confidence:      matchResult.confidence,
      intent:          matchResult.intent,
      extractedParams: matchResult.extractedParams,
      resolvedVia,
      timestamp:       new Date().toISOString(),
    })
  }
}