// ─── Resolver Types ───────────────────────────────────────────────────────────

export type ResolverType = 'api' | 'nav' | 'hybrid'
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

// ─── Parameter Definition ─────────────────────────────────────────────────────

export interface CapabilityParam {
  name: string
  description: string
  required: boolean
  source: 'user_query' | 'session'
  default?: string | number | boolean
}

// ─── Resolver Configs ─────────────────────────────────────────────────────────

export interface ApiResolver {
  type: 'api'
  endpoints: Array<{
    method: HttpMethod
    path: string
    params?: string[]
  }>
}

export interface NavResolver {
  type: 'nav'
  destination: string
  hint?: string
}

export interface HybridResolver {
  type: 'hybrid'
  api: Omit<ApiResolver, 'type'>
  nav: Omit<NavResolver, 'type'>
}

export type Resolver = ApiResolver | NavResolver | HybridResolver

// ─── Privacy Scope ────────────────────────────────────────────────────────────

export interface PrivacyScope {
  level: 'public' | 'user_owned' | 'admin'
  note?: string
}

// ─── Capability Definition ────────────────────────────────────────────────────

export interface Capability {
  id: string
  name: string
  description: string
  examples?: string[]
  params: CapabilityParam[]
  returns: string[]
  resolver: Resolver
  privacy: PrivacyScope
}

// ─── Manifest ─────────────────────────────────────────────────────────────────

export interface Manifest {
  version: string
  app: string
  generatedAt: string
  capabilities: Capability[]
}

// ─── Config File ──────────────────────────────────────────────────────────────

export interface CapmanConfig {
  app: string
  baseUrl?: string
  capabilities: Capability[]
}

// ─── Match Result ─────────────────────────────────────────────────────────────

export interface MatchResult {
  capability: Capability | null
  confidence: number
  intent: 'navigation' | 'retrieval' | 'hybrid' | 'out_of_scope'
  extractedParams: Record<string, string | null>
  reasoning: string
  /** All scored candidates — always present after match() */
  candidates: MatchCandidate[]
}

// ─── Resolve Result ───────────────────────────────────────────────────────────

export interface ApiCallResult {
  method: string
  url: string
  params: Record<string, unknown>
  /** HTTP status code — only present when actually executed (not dry run) */
  status?: number
  /** Parsed JSON response body — only present when actually executed */
  data?: unknown
}

export interface ResolveResult {
  success: boolean
  resolverType: ResolverType | null
  apiCalls?: ApiCallResult[]
  navTarget?: string
  /** Execution time in milliseconds */
  durationMs?: number
  error?: string
}
// ─── Validation ───────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

// ─── Execution Trace ──────────────────────────────────────────────────────────

export interface MatchCandidate {
  capabilityId: string
  score: number
  matched: boolean
}

export interface TraceStep {
  type: 'cache_check' | 'keyword_match' | 'llm_match' | 'privacy_check' | 'resolve'
  status: 'hit' | 'miss' | 'pass' | 'fail' | 'skip'
  durationMs: number
  detail?: string
}

export interface ExecutionTrace {
  query: string
  /** All capabilities scored — not just the winner */
  candidates: MatchCandidate[]
  /** Why the winning capability was selected */
  reasoning: string[]
  /** Step-by-step execution breakdown */
  steps: TraceStep[]
  /** Which matcher was used */
  resolvedVia: 'cache' | 'keyword' | 'llm'
  /** Total duration */
  totalMs: number
}

// ─── Explain Result ───────────────────────────────────────────────────────────

export interface ExplainCandidate {
  capabilityId: string
  score:        number
  matched:      boolean
  /** Human-readable explanation of why this capability scored this way */
  explanation:  string
}

export interface ExplainResult {
  query:      string
  matched: {
    capability: Capability | null
    confidence: number
    intent:     string
    reasoning:  string[]
  }
  candidates:   ExplainCandidate[]
  wouldExecute: {
    resolverType: ResolverType | null
    /** The action that would be taken — e.g. "GET https://api.com/orders/1234" */
    action:       string | null
    privacy:      string | null
    /** Set if privacy enforcement would block execution */
    blocked:      string | null
  }
  resolvedVia:  'keyword' | 'llm'
  durationMs:   number
}

// ─── Match Mode ───────────────────────────────────────────────────────────────

export type MatchMode = 'cheap' | 'balanced' | 'accurate'