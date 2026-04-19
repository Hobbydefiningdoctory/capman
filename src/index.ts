export { setLogLevel } from './logger'
export type { LogLevel } from './logger'

export type {
  Capability,
  CapabilityParam,
  CapmanConfig,
  Manifest,
  MatchResult,
  ExecutionTrace,
  TraceStep,
  MatchCandidate,
  ResolveResult,
  ApiCallResult,
  ValidationResult,
  Resolver,
  ApiResolver,
  NavResolver,
  HybridResolver,
  PrivacyScope,
  ResolverType,
  HttpMethod,
  ExplainResult,
  ExplainCandidate,
} from './types'

export {
  generate,
  loadConfig,
  writeManifest,
  readManifest,
  validate,
  generateStarterConfig,
} from './generator'

export {
  match,
  matchWithLLM,
  extractParams,
} from './matcher'
export type { LLMMatcherOptions } from './matcher'

export { resolve } from './resolver'
export type { ResolveOptions, AuthContext } from './resolver'

// ─── Engine (recommended API) ─────────────────────────────────────────────────
export { CapmanEngine } from './engine'
export type { EngineOptions, EngineResult } from './engine'

// ─── Cache ────────────────────────────────────────────────────────────────────
export { MemoryCache, FileCache, ComboCache, buildCacheKey, normalizeQuery } from './cache'
export type { CacheStore, CacheEntry } from './cache'

// ─── Learning ─────────────────────────────────────────────────────────────────
export { FileLearningStore, MemoryLearningStore } from './learning'
export type { LearningStore, LearningEntry, KeywordStats } from './learning'

export { parseOpenAPI } from './parser'
export type { ParseResult } from './parser'

// ─── Convenience: ask() ───────────────────────────────────────────────────────

import { CapmanEngine } from './engine'
import type { Manifest, MatchResult, ResolveResult, MatchMode } from './types'
import type { LLMMatcherOptions } from './matcher'
import type { ResolveOptions } from './resolver'

export type { MatchMode } from './types'

export interface AskOptions extends ResolveOptions {
  llm?: LLMMatcherOptions['llm']
  /**
   * Controls how intent matching is performed.
   * - 'cheap'    — keyword only, no LLM calls
   * - 'balanced' — keyword first, LLM fallback if confidence < 50% (default)
   * - 'accurate' — LLM first, keyword fallback
   * @default 'balanced'
   */
  mode?: MatchMode
}

export interface AskResult {
  match: MatchResult
  resolution: ResolveResult
}

/**
 * One-shot convenience: match + resolve in a single call.
 * Delegates to CapmanEngine internally.
 *
 * @deprecated For full features including trace and caching, use CapmanEngine directly.
 *
 * @example
 * const result = await ask("show me the dashboard", manifest, {
 *   baseUrl: 'https://api.your-app.com',
 * })
 */
export async function ask(
  query: string,
  manifest: Manifest,
  options: AskOptions = {}
): Promise<AskResult> {
  const { llm, mode, ...resolveOptions } = options

  const engine = new CapmanEngine({
    manifest,
    llm,
    mode,
    cache: false,
    learning: false,
    baseUrl: resolveOptions.baseUrl,
    auth: resolveOptions.auth,
    headers: resolveOptions.headers,
  })

  const result = await engine.ask(query, resolveOptions)
  return { match: result.match, resolution: result.resolution }
}
