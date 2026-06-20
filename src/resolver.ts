import { logger } from './logger'
import type { MatchResult, ResolveResult, ApiResolver, NavResolver, ApiCallResult, CapabilityError, Capability } from './types'

// ─── Constants ────────────────────────────────────────────────────────────────

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// ─── Privacy enforcement ──────────────────────────────────────────────────────

export interface AuthContext {
  /** Whether the current request is authenticated */
  isAuthenticated: boolean
  /** @deprecated Use `roles` instead. Kept for backward compatibility —
   *  checkPrivacy() treats a single `role` as equivalent to `roles: [role]`
   *  when `roles` is not provided. */
  role?: 'user' | 'admin'
  /** Current user's roles — supports multi-role auth, e.g. ['user', 'billing_admin']. */
  roles?: string[]
  /** Current user's ID — injected into session params */
  userId?: string
}

  export interface ResolveOptions {
  baseUrl?: string
  fetch?: typeof globalThis.fetch
  dryRun?: boolean
  headers?: Record<string, string>
  auth?: AuthContext
  /**
    * Pre-known parameter values — skips extraction for these params and uses
    * the given value directly. Useful when the agent already knows a value
    * (e.g. from a dropdown selection, a prior capability result, or a webhook
    * payload) rather than relying on extracting it from the query text.
  */
  knownParams?: Record<string, string>
  /** Number of retries on failure (default: 0) */
  retries?: number
  /** Timeout in milliseconds (default: 5000) */
  timeoutMs?: number
  /**
   * When true, retries all HTTP methods including POST/PUT/PATCH/DELETE.
   * Use only for idempotent write operations — retrying non-idempotent
   * methods can cause duplicate side effects (duplicate orders, double charges).
   * @default false
   */
  retryAllMethods?: boolean
}

function redactParams(params: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, v != null ? '[REDACTED]' : 'null'])
  )
}

  export function checkPrivacy(
    capability: Capability,
    auth?: AuthContext
  ): string | null {
    const level = capability.privacy.level

    // requiredRoles is checked regardless of level — including 'public'. A public
    // capability with requiredRoles set means "anyone can attempt this, but only
    // certain roles actually pass" — level and requiredRoles are independent axes,
    // so 'public' must not early-return before the role check runs.
    if (level === 'user_owned') {
      if (!auth?.isAuthenticated) {
        return `Capability "${capability.id}" requires authentication (privacy: user_owned)`
      }
    }

    if (level === 'admin') {
      if (!auth?.isAuthenticated) {
        return `Capability "${capability.id}" requires authentication (privacy: admin)`
      }
      if (auth.role !== 'admin') {
        return `Capability "${capability.id}" requires admin role (current role: ${auth.role ?? 'none'})`
      }
    }

    if (capability.privacy.requiredRoles?.length) {
      const callerRoles = auth?.roles ?? (auth?.role ? [auth.role] : [])
      const hasRequiredRole = capability.privacy.requiredRoles.some(r => callerRoles.includes(r))
      if (!hasRequiredRole) {
        return `Capability "${capability.id}" requires one of roles [${capability.privacy.requiredRoles.join(', ')}] (current roles: ${callerRoles.join(', ') || 'none'})`
      }
    }

    return null
}


export async function resolve(
  matchResult: MatchResult,
  params: Record<string, unknown> = {},
  options: ResolveOptions = {},
   /**
   * Internal use only — not part of the public resolve() contract via
   * ResolveOptions, deliberately, so a normal caller cannot accidentally
   * bypass privacy enforcement by setting a field on an options object.
   * When provided (including null), this value is used instead of calling
   * checkPrivacy() internally. Used by CapmanEngine when EngineHooks.onAuth
   * has already computed the privacy verdict, so the decision is made
   * exactly once rather than potentially disagreeing with the resolver's
   * own independent built-in check.
   */
  precomputedPrivacyError?: string | null
): Promise<ResolveResult> {
  const { capability } = matchResult

  if (!capability) {
    logger.warn('resolve() called with no matched capability')
    return {
      success: false,
      resolverType: null,
      error: 'No capability matched — cannot resolve',
    }
  }

    // ── Privacy enforcement ──────────────────────────────────────────────────
  const privacyError = precomputedPrivacyError !== undefined
    ? precomputedPrivacyError
    : checkPrivacy(capability, options.auth)
  if (privacyError) {
    logger.warn(`Privacy check failed: ${privacyError}`)
    return {
      success: false,
      resolverType: null,
      error: privacyError,
    }
  }

  // ── Session param injection ───────────────────────────────────────────────
  // Inject auth.userId into params marked as source: 'session'
  // Session params are only injected if they appear as {template} in the path —
  // they must never leak into the query string as ?user_id=xyz
  const enrichedParams = { ...params }
  if (options.auth?.userId !== undefined && options.auth.userId !== '') {
    for (const param of capability.params) {
      if (param.source === 'session') {
        enrichedParams[param.name] = options.auth.userId!
        logger.debug(`Injected session param "${param.name}" (value redacted)`)
      }
    }
  }

  const resolver = capability.resolver
  logger.info(`Resolving capability "${capability.id}" via ${resolver.type} resolver`)
  logger.debug(`Params: ${JSON.stringify(redactParams(params))}`)
  logger.debug(`Options: baseUrl=${options.baseUrl} dryRun=${options.dryRun}`)

  try {
    
    const sessionParamNames = new Set(
      capability.params
        .filter(p => p.source === 'session')
        .map(p => p.name)
    )
    
    switch (resolver.type) {
      case 'api':
        return await resolveApi(resolver, enrichedParams, options, sessionParamNames, capability.errors ?? [])

      case 'nav':
        return resolveNav(resolver, enrichedParams)

      case 'hybrid': {
        logger.debug('Hybrid resolver — running API and nav in parallel')
        const [apiResult, navResult] = await Promise.all([
          resolveApi(resolver.api as ApiResolver, enrichedParams, options, sessionParamNames, capability.errors ?? []),
          Promise.resolve(resolveNav(resolver.nav as NavResolver, enrichedParams)),
        ])
        return {
          success: apiResult.success && navResult.success,
          resolverType: 'hybrid',
          apiCalls: apiResult.apiCalls,
          navTarget: navResult.navTarget,
          error: apiResult.error ?? navResult.error,
        }
      }
    }
  } catch (err) {
    logger.error(`Resolution failed for "${capability.id}": ${err}`)
    return {
      success: false,
      resolverType: resolver.type,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}


/**
 * Resolves an API capability by executing all configured endpoints.
 *
 * ⚠️  PARALLEL EXECUTION: All endpoints are fired simultaneously via Promise.all().
 * If any endpoint fails, the entire result is marked as failed and partial results
 * are discarded — but side effects from successful endpoints cannot be rolled back.
 *
 * Example: a capability with two endpoints [POST /reserve, POST /confirm] will
 * fire both in parallel. If /confirm fails after /reserve succeeded, the reservation
 * exists but the caller receives success: false with no indication that /reserve ran.
 *
 * For capabilities where ordering or rollback matters, define separate capabilities
 * with single endpoints and orchestrate them at the application layer.
 *
 * Note: the current ResolveResult does not expose which endpoints succeeded and
 * which failed in a partial failure scenario. If your use case requires this
 * granularity, use separate single-endpoint capabilities and inspect each result.
 * Full partial success reporting (partialSuccess, completedCalls, failedCalls)
 * is planned for a future version.
 */
async function resolveApi(
  resolver: ApiResolver | Omit<ApiResolver, 'type'>,
  params: Record<string, unknown>,
  options: ResolveOptions,
  sessionParamNames: Set<string> = new Set(),
  capabilityErrors: CapabilityError[] = []
): Promise<ResolveResult> {
  const startTime = Date.now()
  const retries   = options.retries  ?? 0
  const timeoutMs = options.timeoutMs ?? 5000

  // Map url → endpoint metadata for idempotency and Idempotency-Key injection
  const endpointMeta = new Map<string, { idempotent?: boolean; idempotencyKey?: string; sendBody?: boolean }>()

  const apiCalls: ApiCallResult[] = resolver.endpoints.map(endpoint => {
    const endpointParams = { ...params }
    for (const name of sessionParamNames) {
      if (!endpoint.path.includes(`{${name}}`)) {
        delete endpointParams[name]
      }
    }
    const url = buildUrl(options.baseUrl ?? '', endpoint.path, endpointParams, sessionParamNames)
    endpointMeta.set(url, {
      idempotent:     endpoint.idempotent,
      idempotencyKey: endpoint.idempotencyKey,
      sendBody:       endpoint.sendBody,
    })
    return {
      method: endpoint.method,
      url,
      params: Object.fromEntries(
        Object.entries(endpointParams).filter(([, v]) => v !== null && v !== undefined)
      ),
    }
  })

  if (options.dryRun) {
    return { success: true, resolverType: 'api', apiCalls, durationMs: Date.now() - startTime }
  }

  const fetchFn = options.fetch ?? globalThis.fetch
  if (!fetchFn) {
    return {
      success: true, resolverType: 'api', apiCalls,
      durationMs: Date.now() - startTime,
      error: 'No fetch available — returning call plan only',
    }
  }

  // ── Fetch with retry + timeout (iterative — no recursion) ────────────────
      // Only retry safe/idempotent methods — retrying POST/PUT/PATCH/DELETE
      // can cause duplicate side effects (e.g. duplicate orders, double charges).

          async function fetchWithRetry(call: ApiCallResult): Promise<Response> {
            const meta = endpointMeta.get(call.url)
            // Explicit idempotent flag overrides method-based default
            const isIdempotent = meta?.idempotent !== undefined
              ? meta.idempotent
              : SAFE_METHODS.has(call.method)
            const effectiveRetries = (options.retryAllMethods || isIdempotent) ? retries : 0
          let lastErr: unknown = new Error('fetchWithRetry: exhausted all attempts without result')
        for (let attempt = 0; attempt <= effectiveRetries; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
            // Inject Idempotency-Key header when configured
            const idempotencyHeaders: Record<string, string> = {}
            if (meta?.idempotencyKey) {
              const keyValue = call.params[meta.idempotencyKey]
              if (keyValue !== null && keyValue !== undefined) {
                idempotencyHeaders['Idempotency-Key'] = String(keyValue)
              }
            }

             const isBodyMethod = ['POST', 'PUT', 'PATCH'].includes(call.method)
               || (call.method === 'DELETE' && meta?.sendBody === true)
             const bodyHeaders: Record<string, string> = isBodyMethod
               ? { 'Content-Type': 'application/json' }
               : {}
             const res = await fetchFn(call.url, {
              method: call.method,
              headers: { ...bodyHeaders, ...options.headers ?? {}, ...idempotencyHeaders },
              signal: controller.signal,
              body: ['POST', 'PUT', 'PATCH'].includes(call.method)
          ? JSON.stringify(
              Object.fromEntries(
                Object.entries(call.params).filter(([, v]) => v !== null && v !== undefined)
              )
            )
          : undefined,
        })
        clearTimeout(timer)
        // Throw on retryable 5xx — fetch() resolves (doesn't throw) on HTTP errors,
        // so without this check a 503 is returned immediately with no retry.
        // 4xx errors are not retried — they are client errors that won't change.
        if (res.status >= 500 && attempt < effectiveRetries) {
          lastErr = new Error(`HTTP ${res.status}`)
          logger.warn(`Server error ${res.status} (attempt ${attempt + 1}/${effectiveRetries + 1}) — retrying`)
          continue
        }
        return res
      } catch (err) {
        clearTimeout(timer)
        lastErr = err
        const isTimeout = err instanceof Error && err.name === 'AbortError'
          if (attempt < effectiveRetries) {
            logger.warn(`Request failed (attempt ${attempt + 1}/${effectiveRetries + 1}) — retrying: ${isTimeout ? 'timeout' : err}`)
        } else {
          throw isTimeout ? new Error(`Request timed out after ${timeoutMs}ms`) : err
        }
      }
    }
    throw lastErr
  }

  let enrichedCalls: ApiCallResult[] = apiCalls.map(c => ({ ...c }))

  try {
    const settled = await Promise.allSettled(apiCalls.map(c => fetchWithRetry(c)))

    enrichedCalls = await Promise.all(
      settled.map(async (result, i) => {
        if (result.status === 'rejected') {
          const reason = result.reason
          logger.warn(`Endpoint ${apiCalls[i].method} ${apiCalls[i].url} failed: ${reason}`)
          return {
            ...apiCalls[i],
            status: 0,
            error: reason instanceof Error ? reason.message : String(reason),
          }
        }
        const res = result.value
        let data: unknown = undefined
        try {
          const text = await res.text()
          data = text ? JSON.parse(text) : undefined
        } catch { /* non-JSON response body */ }
        return { ...apiCalls[i], status: res.status, data }
      })
    )

    const succeeded = enrichedCalls.filter(
      c => typeof c.status === 'number' && c.status >= 200 && c.status < 300
    )
    const failed = enrichedCalls.filter(
      c => typeof c.status === 'number' && (c.status === 0 || c.status < 200 || c.status >= 300)
    )

    // Partial success — at least one endpoint ran and at least one failed.
    // Side effects from succeeded calls cannot be rolled back; surface this
    // to the consumer so they can handle compensation themselves.
    if (succeeded.length > 0 && failed.length > 0) {
      return {
        success:      false,
        resolverType: 'api',
        apiCalls:     enrichedCalls,
        durationMs:   Date.now() - startTime,
        error:        `${failed.length}/${enrichedCalls.length} endpoints failed`,
        partialSuccess: {
          completedCalls: succeeded,
          failedCalls:    failed.map(c => ({
            ...c,
            error: c.error ?? `HTTP ${c.status ?? 0}`,
          })),
        },
      }
    }

    const failedCall = enrichedCalls.find(
      c => typeof c.status === 'number' && (c.status === 0 || c.status >= 400)
    )
    if (failedCall) {
      const matchedError = capabilityErrors.find(e => e.httpStatus === failedCall.status)
      const statusLabel = failedCall.status === 0 ? 'network failure' : String(failedCall.status)
      return {
        success:      false,
        resolverType: 'api',
        apiCalls:     enrichedCalls,
        durationMs:   Date.now() - startTime,
        error: matchedError
          ? `${matchedError.code}: ${matchedError.description}`
          : `API request failed: ${statusLabel} on ${failedCall.method} ${failedCall.url}`,
        matchedError,
      }
    }

    logger.debug(`API calls completed in ${Date.now() - startTime}ms`)
    return { success: true, resolverType: 'api', apiCalls: enrichedCalls, durationMs: Date.now() - startTime }

  } catch (err) {
    return {
      success: false, resolverType: 'api', apiCalls: enrichedCalls,
      durationMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function validateNavParam(key: string, value: string): void {
  // Block path traversal only — the original allowlist also blocked spaces, which
  // rejects legitimate natural-language params like city="New York" or name="John Smith".
  // encodeURIComponent() safely encodes spaces and all special chars EXCEPT '/'.
  // Slashes and dot-dot sequences are the only values that can escape the path segment.
  if (value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw new Error(
      `Nav param "${key}" contains path traversal characters: "${value}". ` +
      `Forward slashes, backslashes, and ".." sequences are not allowed.`
    )
  }
}

function resolveNav(
  resolver: NavResolver | Omit<NavResolver, 'type'>,
  params: Record<string, unknown>
): ResolveResult {
  let destination = resolver.destination
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue
    const str = String(value)
    validateNavParam(key, str)
    destination = destination.replaceAll(`{${key}}`, encodeURIComponent(str))
  }
  return { success: true, resolverType: 'nav', navTarget: destination }
}

function validateApiPathParam(key: string, value: string): void {
  // Prevent path traversal via unencoded slashes — encodeURIComponent does not
  // encode '/' so a value like '../../admin' would traverse the path hierarchy.
  // The original allowlist also blocked spaces, breaking params like name="John Smith".
  // We target the actual threat (slashes, dot-dot) rather than whitelisting safe chars.
  if (value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw new Error(
      `API path param "${key}" contains path traversal characters: "${value}". ` +
      `Forward slashes, backslashes, and ".." sequences are not allowed.`
    )
  }
}

// Both buildUrl (API) and resolveNav (nav) validate path param values against
// an allowlist before substitution — prevents path traversal via unencoded slashes.
function buildUrl(
  baseUrl: string,
  urlPath: string,
  params: Record<string, unknown>,
  blockedQsParams?: Set<string>
): string {
  let resolved = urlPath
  const unused: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue  // never write null into URLs
    if (resolved.includes(`{${key}}`)) {
      const str = String(value)
      validateApiPathParam(key, str)
      resolved = resolved.replaceAll(`{${key}}`, encodeURIComponent(str))
    } else {
      unused[key] = value
    }
  }

  const base = `${baseUrl.replace(/\/$/, '')}${resolved}`
  const qs   = Object.entries(unused)
  .filter(([k, v]) => v !== null && v !== undefined
    && (!blockedQsParams || !blockedQsParams.has(k)))
  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  .join('&')

  return qs ? `${base}?${qs}` : base
}
