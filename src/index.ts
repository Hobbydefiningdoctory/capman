export { setLogLevel } from './logger'
export type { LogLevel } from './logger'

export type {
  Capability,
  CapabilityParam,
  CapmanConfig,
  Manifest,
  MatchResult,
  ResolveResult,
  ValidationResult,
  Resolver,
  ApiResolver,
  NavResolver,
  HybridResolver,
  PrivacyScope,
  ResolverType,
  HttpMethod,
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
} from './matcher'
export type { LLMMatcherOptions } from './matcher'

export { resolve } from './resolver'
export type { ResolveOptions } from './resolver'

// ─── Convenience: ask() — match + resolve in one call ────────────────────────

import { match as _match, matchWithLLM as _matchWithLLM } from './matcher'
import { resolve as _resolve } from './resolver'
import type { Manifest, MatchResult, ResolveResult } from './types'
import type { LLMMatcherOptions } from './matcher'
import type { ResolveOptions } from './resolver'

export interface AskOptions extends ResolveOptions {
  llm?: LLMMatcherOptions['llm']
}

export interface AskResult {
  match: MatchResult
  resolution: ResolveResult
}

/**
 * One-shot convenience: match + resolve in a single call.
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
  const { llm, ...resolveOptions } = options

  // Tier 1 — try keyword matcher first (fast, no API call)
  const keywordResult = _match(query, manifest)

  // If confident enough, use it directly
  const THRESHOLD = 50
  const matchResult = (keywordResult.confidence >= THRESHOLD || !llm)
    ? keywordResult
    : await _matchWithLLM(query, manifest, { llm })

  const resolution = await _resolve(
    matchResult,
    matchResult.extractedParams as Record<string, unknown>,
    resolveOptions
  )

  return { match: matchResult, resolution }
}