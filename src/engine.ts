import type { Manifest, MatchResult, ResolveResult, ExecutionTrace, TraceStep, ExplainResult, ExplainCandidate, ApiResolver, NavResolver, HybridResolver, ResolverType, MatchCandidate } from './types'
import type { LLMMatcherOptions } from './matcher'
import type { ResolveOptions, AuthContext } from './resolver'
import type { CacheStore } from './cache'
import type { LearningStore, LearningEntry} from './learning'
import { match as _match, matchWithLLM as _matchWithLLM, resolverToIntent, extractParams, STOPWORDS, LLMParseError } from './matcher'
import { resolve as _resolve } from './resolver'
import { MemoryLearningStore } from './learning'
import { logger } from './logger'
import type { MatchMode } from './types'
import { MemoryCache, normalizeQuery } from './cache'
import { VERSION } from './version'

// ─── Engine Options ───────────────────────────────────────────────────────────

/**
 * Options for constructing a CapmanEngine instance.
 *
 * ⚠️  CONCURRENCY: CapmanEngine is not safe for sharing across concurrent
 * async request handlers. The LLM rate limiter, circuit breaker, and
 * learning index cache are all instance-level mutable state. In an
 * Express/Fastify/etc. server, either:
 *   (a) Create one engine per request — safest, no shared state
 *   (b) Use a single instance only with cheap mode (no LLM calls)
 *   (c) Add an external mutex around LLM calls if sharing is required
 *
 * @example
 * // Safe — per-request engine
 * app.post('/ask', async (req, res) => {
 *   const engine = new CapmanEngine({ manifest, llm, mode: 'balanced' })
 *   const result = await engine.ask(req.body.query)
 *   res.json(result)
 * })
 */
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

  /**
   * Optional TTL for cache entries in milliseconds.
   * Entries older than this are treated as misses and evicted on read.
   * Default: no expiry.
   *
   * Useful when capabilities are frequently updated or removed — ensures
   * stale entries don't persist indefinitely after a manifest change.
   *
   * @example
   * // Expire cache entries after 1 hour
   * new CapmanEngine({ manifest, cacheTtlMs: 60 * 60 * 1000 })
   */
  cacheTtlMs?: number
  
  /**
   * Maximum LLM calls per minute in balanced/accurate mode.
   * After limit is hit, falls back to keyword result.
   * @default 60
   */
  maxLLMCallsPerMinute?: number

  /**
   * Minimum milliseconds between consecutive LLM calls.
   * Useful for free-tier models with burst limits.
   * @default 0
   */
  llmCooldownMs?: number

  /**
   * Maximum consecutive LLM failures before circuit breaker opens.
   * When open, LLM calls are skipped for llmCircuitBreakerResetMs.
   * @default 3
   */
  llmCircuitBreakerThreshold?: number

  /**
   * Milliseconds to wait before retrying LLM after circuit breaker opens.
   * @default 60000
   */
  llmCircuitBreakerResetMs?: number
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
  /** Maximum allowed query length in characters. Queries exceeding this throw RangeError. */
  static readonly MAX_QUERY_LENGTH = 1000
  private manifest:  Manifest
  private mode:      MatchMode
  private llm?:      LLMMatcherOptions['llm']
  private cache:     CacheStore | null
  private learning:  LearningStore | null
  private baseUrl?:  string
  private auth?:     AuthContext
  private headers?:  Record<string, string>
  private threshold: number
  private cacheTtlMs: number | null

  // ── LLM rate limiting ──────────────────────────────────────────────────────
  private maxLLMCallsPerMinute:        number
  private llmCooldownMs:               number
  private llmCircuitBreakerThreshold:  number
  private llmCircuitBreakerResetMs:    number

  // ── LLM rate limiting state ────────────────────────────────────────────────
  private llmCallsThisMinute:    number   = 0
  private llmWindowStart:        number   = Date.now()
  private llmLastCallAt:         number   = 0
  private llmConsecutiveFails:   number   = 0
  private llmCircuitOpenAt:      number   = 0

  constructor(options: EngineOptions) {
    this.manifest  = options.manifest
    this.mode      = options.mode ?? 'balanced'
    this.llm       = options.llm
    this.baseUrl   = options.baseUrl
    this.auth      = options.auth
    this.headers   = options.headers
    this.threshold = options.threshold ?? 50
    this.cacheTtlMs = options.cacheTtlMs ?? null
    this.maxLLMCallsPerMinute       = options.maxLLMCallsPerMinute       ?? 60
    this.llmCooldownMs              = options.llmCooldownMs              ?? 0
    this.llmCircuitBreakerThreshold = options.llmCircuitBreakerThreshold ?? 3
    this.llmCircuitBreakerResetMs   = options.llmCircuitBreakerResetMs   ?? 60_000

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
    // ── Manifest version compatibility check ─────────────────────────────────
    if (options.manifest.version) {
      const SEMVER_RE = /^\d+\.\d+\.\d+$/
      if (SEMVER_RE.test(options.manifest.version) && SEMVER_RE.test(VERSION)) {
        const [mMaj, mMin] = options.manifest.version.split('.').map(Number)
        const [eMaj, eMin] = VERSION.split('.').map(Number)
        if (mMaj !== eMaj || mMin !== eMin) {
          console.warn(
            `[capman] Manifest version "${options.manifest.version}" was generated with a ` +
            `different engine version than "${VERSION}". This is usually fine across patch versions. ` +
            `If you experience unexpected matching issues, regenerate with: npx capman generate`
          )
        }
      } else if (options.manifest.version !== VERSION) {
        console.warn(
          `[capman] Manifest version "${options.manifest.version}" could not be compared ` +
          `to engine version "${VERSION}" — version strings are not valid semver.`
        )
      }
    }
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
    if (!query || typeof query !== 'string') {
      throw new TypeError('query must be a non-empty string')
    }
    if (query.length > CapmanEngine.MAX_QUERY_LENGTH) {
      throw new RangeError(`query exceeds maximum length of ${CapmanEngine.MAX_QUERY_LENGTH} characters`)
    }

    const start = Date.now()
    const steps: TraceStep[] = []

    // ── Step 1: Check cache ──────────────────────────────────────────────────
    const cacheStart = Date.now()
    if (this.cache) {
      const queryKey = normalizeQuery(query)
      const cached = await this.cache.get(queryKey, this.cacheTtlMs ?? undefined)
      if (cached) {
        steps.push({ type: 'cache_check', status: 'hit', durationMs: Date.now() - cacheStart, detail: 'Served from cache' })
        logger.info(`Cache hit — capability: "${cached.result.capability?.id ?? 'none'}"`)
        logger.debug(`Cache hit for query: "${query}"`)

        // Re-extract params from the current query — never re-use cached params.
        // Cached params belong to the original query (potentially from a different user).
        // e.g. User A: "show orders for john" → cached with { customer: 'john' }
        //      User B: "show orders for jane" → must get { customer: 'jane' }, not john's
        const freshParams = cached.result.capability
          ? extractParams(query, cached.result.capability)
          : {}
        const matchWithFreshParams: MatchResult = {
          ...cached.result,
          extractedParams: freshParams,
        }

        const resolution = await _resolve(
          matchWithFreshParams,
          freshParams as Record<string, unknown>,
          this.resolveOptions(overrides)
        )
        const trace: ExecutionTrace = {
          query,
          candidates: cached.result.candidates,
          reasoning: [`Served from cache (original: ${cached.result.reasoning})`],
          steps,
          resolvedVia: 'cache',
          totalMs: Date.now() - start,
        }
        const result: EngineResult = {
          match: matchWithFreshParams,
          resolution,
          resolvedVia: 'cache',
          durationMs: Date.now() - start,
          trace,
        }
        await this.recordLearning(query, matchWithFreshParams, 'cache')
        return result
      }
      
      steps.push({ type: 'cache_check', status: 'miss', durationMs: Date.now() - cacheStart })
    } else {
      steps.push({ type: 'cache_check', status: 'skip', durationMs: 0, detail: 'Cache disabled' })
    }

    // ── Step 2: Match ────────────────────────────────────────────────────────
    let { matchResult, resolvedVia } = await this._runMatch(query, steps)

    const preBoostMatchResult = matchResult  // kept for learning recording only — prevents feedback loop

    // ── Step 2.5: Apply learning boost ───────────────────────────────────────
    matchResult = await this.applyBoostToMatchResult(query, matchResult)

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
    
    // ── Step 4: Resolve ──────────────────────────────────────────────────────
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

    // ── Step 5: Cache after successful resolution ────────────────────────────
    // Only cache when resolution succeeded — a failed resolution (network error,
    // auth failure, bad params) must not poison the cache. A cached failed match
    // would cause every subsequent cache hit to attempt the same failing resolution
    // until TTL expires.
    if (this.cache && resolution.success && matchResult.capability
       && matchResult.capability.privacy.level === 'public') {
       const queryKey = normalizeQuery(query)
       await this.cache.set(queryKey, matchResult)
      }

    // ── Step 6: Build reasoning array ────────────────────────────────────────
    const reasoning: string[] = []
    if (matchResult.candidates.length) {
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
    // Record the pre-boost match result — not the boosted one.
    // Recording the boosted winner would reinforce it further on every call,
    // creating a feedback loop that permanently displaces keyword matches.
    await this.recordLearning(query, preBoostMatchResult, resolvedVia)
    const trace: ExecutionTrace = {
      query,
      candidates: matchResult.candidates,
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

  /**
   * Explain what would happen for a query — without executing it.
   * Shows matched capability, all candidate scores with reasoning,
   * and what action would be taken.
   *
   * Note: explain() does not write to cache or learning store.
   * However, if mode is 'balanced' or 'accurate' and an LLM call is made,
   * it consumes LLM quota and affects the cooldown/rate limit state
   * shared with ask(). This is by design — explain() is not free
   * when LLM matching is involved.
   *
   * @example
   * const explanation = await engine.explain('track order 1234')
   * console.log(explanation.matched.reasoning)
   * console.log(explanation.wouldExecute.action)
   * console.log(explanation.candidates)
   */
  
    async explain(query: string): Promise<ExplainResult> {
    if (!query || typeof query !== 'string') {
      throw new TypeError('query must be a non-empty string')
    }
    if (query.length > CapmanEngine.MAX_QUERY_LENGTH) {
      throw new RangeError(`query exceeds maximum length of ${CapmanEngine.MAX_QUERY_LENGTH} characters`)
    }

    const start = Date.now()

    // ── Match — shared with ask() via _runMatch() ─────────────────────────────
      let { matchResult, resolvedVia: _resolvedVia } = await this._runMatch(query)
      // explain() never reads from cache — it always runs a fresh match.
      // This assertion catches any future refactor that accidentally adds
      // cache reads to _runMatch() when called from explain().
      if (_resolvedVia === 'cache') {
        throw new Error('Invariant violation: explain() must never resolve via cache')
      }
      let resolvedVia = _resolvedVia as ExplainResult['resolvedVia']

    // ── Apply learning boost (same as ask()) ─────────────────────────────────
    matchResult = await this.applyBoostToMatchResult(query, matchResult)

    // ── Build candidate explanations ─────────────────────────────────────────
    const candidates: ExplainCandidate[] = matchResult.candidates
      .sort((a, b) => b.score - a.score)
      .map(c => {
        const cap = this.manifest.capabilities.find(mc => mc.id === c.capabilityId)
        let explanation = ''

        if (c.score === 0) {
          explanation = 'No keyword overlap with examples or description'
        } else if (c.score >= 90) {
          explanation = `Strong match (${c.score}%) — query closely matches examples`
        } else if (c.score >= 50) {
          const qWords = query.toLowerCase().split(/\W+/).filter(Boolean)
          const matchedWords = (cap?.examples ?? [])
            .flatMap(e => e.toLowerCase().split(/\s+/))
            .filter(w => qWords.includes(w) && w.length > 2)
          const unique = [...new Set(matchedWords)].slice(0, 3)
          explanation = unique.length
            ? `Matched keywords: ${unique.join(', ')} (${c.score}%)`
            : `Partial match (${c.score}%) — some keyword overlap`
        } else {
          explanation = `Weak match (${c.score}%) — below 50% confidence threshold, rejected`
        }

        return { capabilityId: c.capabilityId, score: c.score, matched: c.matched, explanation }
      })

    // ── Build reasoning array ────────────────────────────────────────────────
    const reasoning: string[] = []
    const winner = candidates.find(c => c.matched)
    const rejected = candidates.filter(c => !c.matched && c.score > 0).slice(0, 3)

    if (winner) {
      reasoning.push(`Matched "${winner.capabilityId}" with ${winner.score}% confidence`)
    } else {
      reasoning.push('No capability matched above the 50% confidence threshold')
    }
    if (rejected.length) {
      reasoning.push(`Rejected: ${rejected.map(r => `${r.capabilityId} (${r.score}%)`).join(', ')}`)
    }
    reasoning.push(`Resolved via: ${resolvedVia}`)
    if (matchResult.extractedParams && Object.keys(matchResult.extractedParams).length) {
      const extracted = Object.entries(matchResult.extractedParams)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')
      const session = matchResult.capability?.params
        .filter(p => p.source === 'session')
        .map(p => `${p.name}=[from auth]`)
        .join(', ')
      const parts = [extracted, session].filter(Boolean).join(', ')
      if (parts) reasoning.push(`Would extract params: ${parts}`)
    }

    // ── Build wouldExecute ───────────────────────────────────────────────────
    const cap = matchResult.capability
    let action: string | null = null
    let blocked: string | null = null
    let privacy: string | null = null
    let resolverType: ResolverType | null = null

    if (cap) {
      privacy = cap.privacy.level
      resolverType = cap.resolver.type as ResolverType

      // Check if privacy would block — mirrors checkPrivacy() in resolver.ts
      if (cap.privacy.level === 'user_owned') {
        if (!this.auth?.isAuthenticated) {
          blocked = `Capability "${cap.id}" requires authentication (privacy: user_owned)`
        }
      } else if (cap.privacy.level === 'admin') {
        if (!this.auth?.isAuthenticated) {
          blocked = `Capability "${cap.id}" requires authentication (privacy: admin)`
        } else if (this.auth.role !== 'admin') {
          blocked = `Capability "${cap.id}" requires admin role (current role: ${this.auth.role ?? 'none'})`
        }
      }
  

      if (!blocked) {
        // Build action string
        const params = matchResult.extractedParams as Record<string, string>

        if (cap.resolver.type === 'api') {
          const endpoint = (cap.resolver as ApiResolver).endpoints[0]
          let path = endpoint.path
          for (const [k, v] of Object.entries(params)) {
            if (v) path = path.replaceAll(`{${k}}`, v)
          }
          const base = this.baseUrl ?? ''
          action = `${endpoint.method} ${base}${path}`
        } else if (cap.resolver.type === 'nav') {
          let dest = (cap.resolver as NavResolver).destination
          for (const [k, v] of Object.entries(params)) {
            if (v) dest = dest.replaceAll(`{${k}}`, v)
          }
          action = `navigate → ${dest}`
        } else if (cap.resolver.type === 'hybrid') {
          const hybrid = cap.resolver as HybridResolver
          const endpoint = hybrid.api.endpoints[0]
          let path = endpoint.path
          for (const [k, v] of Object.entries(params)) {
            if (v) path = path.replaceAll(`{${k}}`, v)
          }
          let dest = hybrid.nav.destination
          for (const [k, v] of Object.entries(params)) {
            if (v) dest = dest.replaceAll(`{${k}}`, v)
          }
          const base = this.baseUrl ?? ''
          action = `${endpoint.method} ${base}${path} + navigate → ${dest}`
        }
      }
    }

    return {
      query,
      matched: {
        capability: matchResult.capability,
        confidence: matchResult.confidence,
        intent:     matchResult.intent,
        reasoning,
      },
      candidates,
      wouldExecute: { resolverType, action, privacy, blocked },
      resolvedVia,
      durationMs: Date.now() - start,
    }
  }

  /**
   * Checks all rate limiting and circuit breaker conditions.
   * Returns null if LLM call is allowed, or a skip reason string if it should be skipped.
   */
  private checkLLMAllowed(): string | null {
    const now = Date.now()

    // ── Circuit breaker ──────────────────────────────────────────────────────
    if (this.llmCircuitOpenAt > 0) {
      const elapsed = now - this.llmCircuitOpenAt
      if (elapsed < this.llmCircuitBreakerResetMs) {
        const remainingSec = Math.ceil((this.llmCircuitBreakerResetMs - elapsed) / 1000)
        return `circuit breaker open — ${remainingSec}s remaining`
      }
      // Reset circuit breaker — try again
      logger.info('LLM circuit breaker reset — trying again')
      this.llmCircuitOpenAt    = 0
      this.llmConsecutiveFails = 0
    }

    // ── Cooldown between calls ───────────────────────────────────────────────
    if (this.llmCooldownMs > 0 && this.llmLastCallAt > 0) {
      const elapsed = now - this.llmLastCallAt
      if (elapsed < this.llmCooldownMs) {
        const remainingMs = this.llmCooldownMs - elapsed
        return `cooldown active — ${remainingMs}ms remaining`
      }
    }

    // ── Per-minute rate limit ────────────────────────────────────────────────
    const windowElapsed = now - this.llmWindowStart
    if (windowElapsed >= 60_000) {
      this.llmCallsThisMinute = 0
      this.llmWindowStart     = now
    }

    if (this.llmCallsThisMinute >= this.maxLLMCallsPerMinute) {
      // Recalculate elapsed after possible window reset above
      const resetIn = Math.ceil((60_000 - (now - this.llmWindowStart)) / 1000)
      return `rate limit reached (${this.maxLLMCallsPerMinute}/min) — resets in ${Math.max(0, resetIn)}s`
    }

    // Reserve the slot atomically before the call happens
    this.llmCallsThisMinute++
    this.llmLastCallAt = Date.now()
    return null
  }

  /**
   * Records a successful LLM call — updates rate limit counters.
   */
  private recordLLMSuccess(): void {
    this.llmConsecutiveFails = 0
  }

  /**
   * Records a failed LLM call — may open the circuit breaker.
   */
  private recordLLMFailure(): void {
    this.llmConsecutiveFails++
    if (this.llmConsecutiveFails >= this.llmCircuitBreakerThreshold) {
      this.llmCircuitOpenAt = Date.now()
      logger.warn(`LLM circuit breaker opened after ${this.llmConsecutiveFails} consecutive failures — pausing for ${this.llmCircuitBreakerResetMs / 1000}s`)
    }
  }


  /**
   * Runs the matching pipeline for a query — shared by ask() and explain().
   * Handles cheap / balanced / accurate mode dispatch and LLM rate limiting.
   * Returns the match result and which resolver was used.
   */
  private async _runMatch(
    query: string,
    steps?: TraceStep[]
  ): Promise<{ matchResult: MatchResult; resolvedVia: EngineResult['resolvedVia'] }> {
    let matchResult: MatchResult
    let resolvedVia: EngineResult['resolvedVia'] = 'keyword'

    switch (this.mode) {
      case 'cheap': {
        const t = Date.now()
        matchResult = _match(query, this.manifest)
        steps?.push({ type: 'keyword_match', status: 'pass', durationMs: Date.now() - t, detail: `confidence: ${matchResult.confidence}%` })
        break
      }

      case 'accurate': {
        if (this.llm) {
          const skipReason = this.checkLLMAllowed()
          if (skipReason) {
            logger.warn(`LLM skipped — ${skipReason} — falling back to keyword`)
            const t = Date.now()
            matchResult = _match(query, this.manifest)
            steps?.push({ type: 'keyword_match', status: 'pass', durationMs: Date.now() - t, detail: `llm skipped: ${skipReason}` })
          } else {
            const t = Date.now()
            try {
              matchResult = await _matchWithLLM(query, this.manifest, { llm: this.llm })
              this.recordLLMSuccess()
              resolvedVia = 'llm'
              // Merge keyword scores into LLM candidates so boost has real signal for alternatives
              const kwResult = _match(query, this.manifest)
              matchResult = {
                ...matchResult,
                candidates: matchResult.candidates.map(c => ({
                  ...c,
                  score: c.matched
                    ? c.score  // keep LLM confidence for winner
                    : (kwResult.candidates.find(kc => kc.capabilityId === c.capabilityId)?.score ?? 0),
                })),
              }
              steps?.push({ type: 'llm_match', status: 'pass', durationMs: Date.now() - t, detail: `confidence: ${matchResult.confidence}%` })
            } catch (err) {
              const isParseError = err instanceof LLMParseError
              if (!isParseError) this.recordLLMFailure()
              logger.warn(`LLM call failed — falling back to keyword: ${err instanceof Error ? err.message : String(err)}`)
              const t2 = Date.now()
              matchResult = _match(query, this.manifest)
              steps?.push({ type: 'llm_match', status: 'fail', durationMs: Date.now() - t, detail: String(err) })
              steps?.push({ type: 'keyword_match', status: 'pass', durationMs: Date.now() - t2, detail: 'fallback after llm failure' })
            }
          }
        } else {
          logger.warn('accurate mode requires llm — falling back to keyword')
          const t = Date.now()
          matchResult = _match(query, this.manifest)
          steps?.push({ type: 'keyword_match', status: 'pass', durationMs: Date.now() - t, detail: 'llm not provided, used keyword' })
        }
        break
      }

      case 'balanced':
      default: {
        const t1 = Date.now()
        const keywordResult = _match(query, this.manifest)
        steps?.push({ type: 'keyword_match', status: 'pass', durationMs: Date.now() - t1, detail: `confidence: ${keywordResult.confidence}%` })

        if (keywordResult.confidence >= this.threshold || !this.llm) {
          matchResult = keywordResult
        } else {
          const skipReason = this.checkLLMAllowed()
          if (skipReason) {
            logger.warn(`LLM skipped — ${skipReason}`)
            steps?.push({ type: 'llm_match', status: 'skip', durationMs: 0, detail: skipReason })
            matchResult = keywordResult
          } else {
            logger.info(`Low keyword confidence (${keywordResult.confidence}%) — escalating to LLM`)
            logger.debug(`Query escalated to LLM: "${query}"`)
            const t2 = Date.now()
            try {
              matchResult = await _matchWithLLM(query, this.manifest, { llm: this.llm })
              this.recordLLMSuccess()
              resolvedVia = 'llm'
              // keywordResult already computed above in balanced mode — merge scores
              matchResult = {
                ...matchResult,
                candidates: matchResult.candidates.map(c => ({
                  ...c,
                  score: c.matched
                    ? c.score
                    : (keywordResult.candidates.find(kc => kc.capabilityId === c.capabilityId)?.score ?? 0),
                })),
              }
              steps?.push({ type: 'llm_match', status: 'pass', durationMs: Date.now() - t2, detail: `confidence: ${matchResult.confidence}%` })
            } catch (err) {
              const isParseError = err instanceof LLMParseError
              if (!isParseError) this.recordLLMFailure()
              logger.warn(`LLM call failed — falling back to keyword: ${err instanceof Error ? err.message : String(err)}`)
              steps?.push({ type: 'llm_match', status: 'fail', durationMs: Date.now() - t2, detail: String(err) })
              matchResult = keywordResult
            }
          }
        }
        break
      }
    }

    return { matchResult: matchResult!, resolvedVia }
  }

  /**
   * Applies learning boost to a MatchResult and returns the updated result.
   * Shared by ask() and explain() to avoid logic divergence.
   */
  private async applyBoostToMatchResult(
    query: string,
    matchResult: MatchResult
  ): Promise<MatchResult> {
    const hasKeywordSignal = matchResult.candidates.some(c => c.score > 0)
    if (!hasKeywordSignal || matchResult.candidates.length === 0 || !this.learning || this.mode === 'cheap') {
      return matchResult
    }

    const boosted = await this.applyLearningBoost(query, matchResult.candidates)
    if (boosted.length === 0) return matchResult

    const newWinner = boosted.reduce((a, b) => {
      if (b.score > a.score) return b
      if (b.score === a.score && b.matched) return b  // original winner wins ties
      return a
    })
    const oldWinner = matchResult.candidates.find(c => c.matched)

    if (newWinner.capabilityId !== oldWinner?.capabilityId && newWinner.score >= this.threshold) {
      const newCap    = this.manifest.capabilities.find(c => c.id === newWinner.capabilityId) ?? null
      const newParams = newCap ? extractParams(query, newCap) : {}
      logger.info(`Learning boost changed winner: "${oldWinner?.capabilityId ?? 'none'}" → "${newWinner.capabilityId}"`)
      return {
        ...matchResult,
        capability:      newCap,
        confidence:      newWinner.score,
        intent:          newCap ? resolverToIntent(newCap) : 'out_of_scope',
        extractedParams: newParams,
        candidates:      boosted.map(c => ({ ...c, matched: c.capabilityId === newWinner.capabilityId })),
        reasoning:       `Matched "${newWinner.capabilityId}" via learning boost (score: ${newWinner.score})`,
      }
    }

    return {
      ...matchResult,
      confidence: newWinner.score,
      candidates: boosted.map(c => ({ ...c, matched: c.capabilityId === (oldWinner?.capabilityId ?? '') })),
    }
  }
  

  /**
   * Applies learning boost to match candidates based on historical usage.
   * Capabilities that have previously matched similar keywords get a small
   * score boost — capped at +15 to avoid overriding strong keyword matches.
   */
  private async applyLearningBoost(
    query: string,
    candidates: MatchCandidate[]
  ): Promise<MatchCandidate[]> {
    if (!this.learning) return candidates

    // Use cached stats — rebuilt only when new entries recorded
    const stats = await this.learning.getStats()
    if (!stats || Object.keys(stats.index).length === 0) return candidates

    const qWords = query.toLowerCase().split(/\W+/).filter(w => w.length > 2 && !STOPWORDS.has(w))
    if (qWords.length === 0) return candidates

    return candidates.map(candidate => {
      let boost = 0

      for (const word of qWords) {
        const wordIndex = stats.index[word]
        if (!wordIndex) continue
        const hits = wordIndex[candidate.capabilityId] ?? 0
        if (hits > 0) {
          // Logarithmic boost — diminishing returns after first few hits
          boost += Math.min(5, Math.log2(hits + 1) * 2)
        }
      }

      const cappedBoost = Math.min(15, Math.round(boost))
      if (cappedBoost > 0) {
        logger.debug(
          `Learning boost: "${candidate.capabilityId}" +${cappedBoost} points ` +
          `(was ${candidate.score}%)`
        )
      }

      return {
        ...candidate,
        score: Math.min(100, candidate.score + cappedBoost),
      }
    })
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
