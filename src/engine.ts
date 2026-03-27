import type { Manifest, MatchResult, ResolveResult, ExecutionTrace, TraceStep } from './types'
import type { LLMMatcherOptions } from './matcher'
import type { ResolveOptions, AuthContext } from './resolver'
import type { CacheStore } from './cache'
import type { LearningStore, LearningEntry } from './learning'
import { match as _match, matchWithLLM as _matchWithLLM } from './matcher'
import { resolve as _resolve } from './resolver'
import { MemoryLearningStore } from './learning'
import { logger } from './logger'
import type { MatchMode } from './index'
import { MemoryCache, normalizeQuery } from './cache'

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
  /** Cache store — defaults to MemoryCache. Use FileCache or ComboCache for persistence. */
  cache?: CacheStore | false
  /** Learning store — defaults to MemoryLearningStore. Use FileLearningStore for persistence. */
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
  resolvedVia: 'cache' | 'keyword' | 'llm'
  durationMs: number
  /** Full execution trace — always present */
  trace: ExecutionTrace
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

    // Cache — default MemoryCache (no filesystem writes), or disabled with false
    // Use FileCache or ComboCache explicitly for persistence across restarts
    this.cache = options.cache === false
      ? null
      : (options.cache ?? new MemoryCache())

    // Learning — default MemoryLearningStore (no filesystem writes), or disabled with false
    // Use FileLearningStore explicitly for persistence across restarts
    this.learning = options.learning === false
      ? null
      : (options.learning ?? new MemoryLearningStore())

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
    const steps: TraceStep[] = []
    let resolvedVia: EngineResult['resolvedVia'] = 'keyword'

    // ── Step 1: Check cache ──────────────────────────────────────────────────
    const cacheStart = Date.now()
    if (this.cache) {
      const queryKey = normalizeQuery(query)
      const cached = await this.cache.get(queryKey)
      if (cached) {
        steps.push({ type: 'cache_check', status: 'hit', durationMs: Date.now() - cacheStart, detail: 'Served from cache' })
        logger.info(`Cache hit for: "${query}"`)
        const resolution = await _resolve(
          cached.result,
          cached.result.extractedParams as Record<string, unknown>,
          this.resolveOptions(overrides)
        )
        const trace: ExecutionTrace = {
          query,
          candidates: cached.result.candidates ?? [],
          reasoning: [`Served from cache (original: ${cached.result.reasoning})`],
          steps,
          resolvedVia: 'cache',
          totalMs: Date.now() - start,
        }
        const result: EngineResult = {
          match: cached.result,
          resolution,
          resolvedVia: 'cache',
          durationMs: Date.now() - start,
          trace,
        }
        await this.recordLearning(query, cached.result, 'cache')
        return result
      }
      steps.push({ type: 'cache_check', status: 'miss', durationMs: Date.now() - cacheStart })
    } else {
      steps.push({ type: 'cache_check', status: 'skip', durationMs: 0, detail: 'Cache disabled' })
    }

    // ── Step 2: Match ────────────────────────────────────────────────────────
    let matchResult: MatchResult

    switch (this.mode) {
      case 'cheap': {
        const t = Date.now()
        matchResult = _match(query, this.manifest)
        steps.push({ type: 'keyword_match', status: 'pass', durationMs: Date.now() - t, detail: `confidence: ${matchResult.confidence}%` })
        break
      }

      case 'accurate': {
        if (this.llm) {
          const t = Date.now()
          matchResult = await _matchWithLLM(query, this.manifest, { llm: this.llm })
          resolvedVia = 'llm'
          steps.push({ type: 'llm_match', status: 'pass', durationMs: Date.now() - t, detail: `confidence: ${matchResult.confidence}%` })
        } else {
          logger.warn('accurate mode requires llm — falling back to keyword')
          const t = Date.now()
          matchResult = _match(query, this.manifest)
          steps.push({ type: 'keyword_match', status: 'pass', durationMs: Date.now() - t, detail: 'llm not provided, used keyword' })
        }
        break
      }

      case 'balanced':
      default: {
        const t1 = Date.now()
        const keywordResult = _match(query, this.manifest)
        steps.push({ type: 'keyword_match', status: 'pass', durationMs: Date.now() - t1, detail: `confidence: ${keywordResult.confidence}%` })

        if (keywordResult.confidence >= this.threshold || !this.llm) {
          matchResult = keywordResult
        } else {
          logger.info(`Low confidence (${keywordResult.confidence}%) — escalating to LLM`)
          const t2 = Date.now()
          matchResult = await _matchWithLLM(query, this.manifest, { llm: this.llm })
          resolvedVia = 'llm'
          steps.push({ type: 'llm_match', status: 'pass', durationMs: Date.now() - t2, detail: `confidence: ${matchResult.confidence}%` })
        }
        break
      }
    }

    // ── Step 3: Privacy check ────────────────────────────────────────────────
    if (matchResult.capability) {
      const privacyLevel = matchResult.capability.privacy.level
      steps.push({
        type: 'privacy_check',
        status: 'pass',
        durationMs: 0,
        detail: `level: ${privacyLevel}`,
      })
    }

    // ── Step 4: Cache the match result ───────────────────────────────────────
    if (this.cache && matchResult.capability) {
      const queryKey = normalizeQuery(query)
      await this.cache.set(queryKey, matchResult)
    }
    
    // ── Step 5: Resolve ──────────────────────────────────────────────────────
    const resolveStart = Date.now()
    const resolution = await _resolve(
      matchResult,
      matchResult.extractedParams as Record<string, unknown>,
      this.resolveOptions(overrides)
    )
    steps.push({
      type: 'resolve',
      status: resolution.success ? 'pass' : 'fail',
      durationMs: Date.now() - resolveStart,
      detail: resolution.error ?? `via ${resolution.resolverType}`,
    })

    // ── Step 6: Build reasoning array ────────────────────────────────────────
    const reasoning: string[] = []
    if (matchResult.candidates?.length) {
      const winner = matchResult.candidates.find(c => c.matched)
      const rejected = matchResult.candidates
        .filter(c => !c.matched && c.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)

      if (winner) {
        reasoning.push(`Matched "${winner.capabilityId}" with ${winner.score}% confidence`)
      }
      if (rejected.length) {
        reasoning.push(`Rejected: ${rejected.map(r => `${r.capabilityId} (${r.score}%)`).join(', ')}`)
      }
      reasoning.push(`Resolved via: ${resolvedVia}`)
      if (matchResult.extractedParams && Object.keys(matchResult.extractedParams).length) {
        const params = Object.entries(matchResult.extractedParams)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')
        reasoning.push(`Extracted params: ${params}`)
      }
    } else {
      reasoning.push(matchResult.reasoning)
    }

    // ── Step 7: Record learning ──────────────────────────────────────────────
    await this.recordLearning(query, matchResult, resolvedVia)

    const trace: ExecutionTrace = {
      query,
      candidates: matchResult.candidates ?? [],
      reasoning,
      steps,
      resolvedVia,
      totalMs: Date.now() - start,
    }

    return {
      match: matchResult,
      resolution,
      resolvedVia,
      durationMs: Date.now() - start,
      trace,
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
