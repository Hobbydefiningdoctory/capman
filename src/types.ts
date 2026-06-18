// ─── Resolver Types ───────────────────────────────────────────────────────────

export type ResolverType = 'api' | 'nav' | 'hybrid'
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

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

export interface Endpoint {
  method:            HttpMethod
  path:              string
  params?:           string[]
  /**
   * Whether this endpoint is idempotent — safe to retry on failure.
   * Defaults: true for GET/HEAD/OPTIONS, false for POST/PUT/PATCH/DELETE.
   * Set explicitly to override — e.g. `idempotent: true` on a POST
   * with an idempotency key allows retries without `retryAllMethods: true`.
   */
  idempotent?:       boolean
  /**
   * Name of the param whose value is sent as the `Idempotency-Key` header.
   * When set and the param is available, the header is injected automatically.
   * e.g. idempotencyKey: 'order_id' → `Idempotency-Key: ORD-12345`
   */
  idempotencyKey?:   string
  /**
   * When true, a JSON body is sent even for DELETE requests.
   * Some APIs (e.g. Elasticsearch) accept a body on DELETE for query params.
   */
  sendBody?:         boolean
}

export interface ApiResolver {
  type:      'api'
  endpoints: Endpoint[]
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

// ─── EmbeddingProvider ────────────────────────────────────────────────────────

/**
 * Optional embedding provider for semantic similarity matching.
 * Zero mandatory dependency — only used when passed to EngineOptions.
 * Implement with any model: OpenAI, local ONNX, Transformers.js, etc.
 */
export interface EmbeddingProvider {
  /** Encode a batch of texts into fixed-length float vectors. */
  encode(texts: string[]): Promise<number[][]>
}

// ─── EngineHealth ──────────────────────────────────────────────────────────────

export interface EngineHealth {
  status: 'healthy' | 'degraded' | 'unhealthy'
  manifest: {
    schemaVersion:   string
    capabilityCount: number
    app:             string
  }
  llm: {
    circuitBreakerOpen:    boolean
    circuitBreakerResetIn?: number  // ms remaining — only present when circuit is open
    callsThisMinute:       number
    maxCallsPerMinute:     number
    consecutiveFails:      number
  }
  cache: {
    enabled: boolean
    size:    number
  }
  learning: {
    enabled:      boolean
    totalQueries: number
  }
  embedding: {
    enabled: boolean
    ready:   boolean  // false if pre-encoding is in progress or failed
  }
}

export interface MatchHint {
  /**
   * Advisory preferred matching mode for this capability.
   * The engine logs when it ignores the hint (e.g. engine is in cheap mode
   * but capability prefers accurate). Never enforced — library must not
   * restrict what consumers can do.
   */
  preferredMode?: MatchMode
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
  /** Documentation only — not read by the engine, matcher, or resolver at runtime.
   *  Describes what the API response contains. Useful for developer reference and
   *  future response validation tooling. */
  returns:     string[]
  resolver:    Resolver
  privacy:     PrivacyScope
  /** Lifecycle status — defaults to 'stable' when absent */
  lifecycle?:  LifecycleInfo
  /** Tags for grouping and filtering capabilities */
  tags?:       string[]
  errors?:     CapabilityError[]
  matchHint?:  MatchHint
  }
// ─── ManifestInfo ─────────────────────────────────────────────────────────────────

export interface ManifestInfo {
  /** Human-readable title for the app */
  title?:       string
  /** Brief description of what the app does */
  description?: string
  /** App's own version — distinct from capman package version */
  version?:     string
  /** URL to the app's homepage or documentation */
  homepage?:    string
  contact?: {
    name?:  string
    email?: string
    url?:   string
  }
  license?: {
    /** SPDX license identifier e.g. "MIT", "Apache-2.0" */
    name:  string
    url?:  string
  }
}

export interface Server {
  url:           string
  description?:  string
  /**
   * Environment this server belongs to.
   * Engine selects server by matching EngineOptions.environment.
   * Fallback: first server in array when no environment matches.
   */
  environment?:  'production' | 'staging' | 'development' | string
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
  /** Optional metadata block for documentation and provenance */
  info?:         ManifestInfo
  /**
   * Server definitions. When present, engine selects baseUrl from this list.
   * Falls back to EngineOptions.baseUrl if servers is absent or no match found.
   */
  servers?:      Server[]
}

// ─── Config File ──────────────────────────────────────────────────────────────

export interface CapmanConfig {
  app:           string
  baseUrl?:      string
  capabilities:  Capability[]
  /** Optional metadata — written to manifest.info */
  info?:         ManifestInfo
  /** Optional tag registry — written to manifest.tagRegistry */
  tagRegistry?:  Record<string, { description: string }>
    /** Server definitions — written to manifest.servers */
  servers?:      Server[]
}

// ─── Match Result ─────────────────────────────────────────────────────────────

export interface MatchResult {
  capability: Capability | null
  confidence: number
  intent: 'navigation' | 'retrieval' | 'action' | 'hybrid' | 'out_of_scope'
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
  /**
    * When multiple endpoints are configured and at least one succeeded while
    * at least one failed, this field is populated.
    * Undefined when all succeeded, all failed, or on dryRun.
   */
  partialSuccess?: {
    completedCalls: ApiCallResult[]
    failedCalls:    Array<ApiCallResult & { error: string }>
    }
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