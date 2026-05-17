// ─── Resolver Types ───────────────────────────────────────────────────────────

export type ResolverType = 'api' | 'nav' | 'hybrid'
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

// ─── Parameter Definition ─────────────────────────────────────────────────────

export type ParamType = 'string' | 'number' | 'boolean' | 'date' | 'email' | 'url' | 'enum' | 'object'

export interface CapabilityParam {
  name:        string
  description: string
  required:    boolean
  source:      'user_query' | 'session'
  /**
   * Optional extraction hint. Either a named type or an example template.
   * Named types: 'email' | 'date' | 'orderId' | 'url'
   * Example template: "order {paramName}" — extracts token after "order"
   */
  pattern?:    string
  /**
   * Semantic type of the parameter value.
   * When set, implies a TYPE_PATTERNS match without requiring pattern to be set.
   * 'email', 'date', 'url' map directly to TYPE_PATTERNS regex.
   * 'enum' requires the enum field to be set with allowed values.
   * 'number', 'boolean', 'object' affect coercion in LLM extraction.
   */
  type?:       ParamType
  /**
   * Allowed values when type === 'enum'.
   * Extracted values not in this list are rejected and added to missingParams.
   */
  enum?:       string[]
  /**
   * Single concrete example for LLM param prompting.
   * Helps the LLM understand what a valid value looks like.
   * e.g. example: "ORD-12345"
   */
  example?:    string
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

export type LifecycleStatus = 'stable' | 'beta' | 'experimental' | 'deprecated'

export interface LifecycleInfo {
  status:        LifecycleStatus
  /** ISO 8601 — when the capability was deprecated */
  deprecatedAt?: string
  /** ISO 8601 — when the capability will stop working */
  sunsetAt?:     string
  /** Capability id to use instead of this one */
  successor?:    string
  /** Human-readable note for consumers */
  note?:         string
}

export interface CapabilityError {
  /** Machine-readable error code e.g. "ORDER_NOT_FOUND", "INSUFFICIENT_FUNDS" */
  code:         string
  /** Human-readable description for developers */
  description:  string
  /** HTTP status code this error maps to */
  httpStatus?:  number
  /**
   * Whether the agent should retry after this error.
   * true  — transient (503, timeout) — retry is safe
   * false — permanent (422, 404) — retrying won't help, ask user
   */
  retryable?:   boolean
}

export interface Capability {
  id:          string
  name:        string
  description: string
  examples?:   string[]
  params:      CapabilityParam[]
  returns:     string[]
  resolver:    Resolver
  privacy:     PrivacyScope
  /** Lifecycle status — defaults to 'stable' when absent */
  lifecycle?:  LifecycleInfo
  /** Tags for grouping and filtering capabilities */
  tags?:       string[]
  errors?:     CapabilityError[]
  }

// ─── Manifest ─────────────────────────────────────────────────────────────────

export interface Manifest {
  /**
   * Manifest format version — independent of the capman package version.
   * Consumers use this to determine which parser/validator to apply.
   * "1" = v0.6+ schema (tags, lifecycle, typed params, servers, etc.)
   */
  schemaVersion: string
  /** capman package version that generated this manifest */
  version:      string
  app:          string
  generatedAt:  string
  capabilities: Capability[]
  /**
   * Optional registry of known tags with descriptions.
   * Used for documentation and validation — not required for tags to work.
   */
  tagRegistry?:  Record<string, { description: string }>
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
  /** Error message — only present on network-level failure (status 0) */
  error?: string 
}

export interface ResolveResult {
  success:      boolean
  resolverType: ResolverType | null
  error?:       string
  /** Structured error from capability.errors[] when httpStatus matches */
  matchedError?: CapabilityError
  apiCalls?:    ApiCallResult[]
  navTarget?:   string
  status?:      number
  data?:        unknown
  durationMs?:  number
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