export { setLogLevel } from './logger'
export type { LogLevel } from './logger'
import { logger } from './logger'

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
export type { ResolveOptions, AuthContext } from './resolver'

// ─── Convenience: ask() — match + resolve in one call ────────────────────────

import { match as _match, matchWithLLM as _matchWithLLM } from './matcher'
import { resolve as _resolve } from './resolver'
import type { Manifest, MatchResult, ResolveResult } from './types'
import type { LLMMatcherOptions } from './matcher'
import type { ResolveOptions } from './resolver'

export type MatchMode = 'cheap' | 'balanced' | 'accurate'

export interface AskOptions extends ResolveOptions {
  llm?: LLMMatcherOptions['llm']
  /**
   * Controls how intent matching is performed.
   *
   * - 'cheap'    — keyword matching only. No LLM calls. Free but less accurate.
   * - 'balanced' — keyword first. Falls back to LLM if confidence < 50%. (default)
   * - 'accurate' — LLM first. Falls back to keyword if LLM call fails.
   *
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
  const { llm, mode = 'balanced', ...resolveOptions } = options

  let matchResult: MatchResult

  switch (mode) {
    case 'cheap': {
      // Keyword only — never calls LLM
      matchResult = _match(query, manifest)
      break
    }

    case 'accurate': {
      // LLM first — falls back to keyword if LLM fails or no llm provided
      if (llm) {
        matchResult = await _matchWithLLM(query, manifest, { llm })
      } else {
        logger.warn('ask() mode is "accurate" but no llm function was provided — falling back to keyword matching')
        matchResult = _match(query, manifest)
      }
      break
    }

    case 'balanced':
    default: {
      // Keyword first — LLM fallback if confidence below threshold
      const keywordResult = _match(query, manifest)
      const THRESHOLD = 50
      matchResult = (keywordResult.confidence >= THRESHOLD || !llm)
        ? keywordResult
        : await _matchWithLLM(query, manifest, { llm })
      break
    }
  }

  const resolution = await _resolve(
    matchResult,
    matchResult.extractedParams as Record<string, unknown>,
    resolveOptions
  )

  return { match: matchResult, resolution }
}