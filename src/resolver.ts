import { logger } from './logger'
import type { MatchResult, ResolveResult, ApiResolver, NavResolver, ApiCallResult } from './types'

// ─── Constants ────────────────────────────────────────────────────────────────

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// ─── Privacy enforcement ──────────────────────────────────────────────────────

export interface AuthContext {
  /** Whether the current request is authenticated */
  isAuthenticated: boolean
  /** Current user's role */
  role?: 'user' | 'admin'
  /** Current user's ID — injected into session params */
  userId?: string
}

export interface ResolveOptions {
  baseUrl?: string
  fetch?: typeof globalThis.fetch
  dryRun?: boolean
  headers?: Record<string, string>
  auth?: AuthContext
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

function checkPrivacy(
  capability: import('./types').Capability,
  auth?: AuthContext
): string | null {
  const level = capability.privacy.level

  if (level === 'public') return null

  if (level === 'user_owned') {
    if (!auth?.isAuthenticated) {
      return `Capability "${capability.id}" requires authentication (privacy: user_owned)`
    }
    return null
  }

  if (level === 'admin') {
    if (!auth?.isAuthenticated) {
      return `Capability "${capability.id}" requires authentication (privacy: admin)`
    }
    if (auth.role !== 'admin') {
      return `Capability "${capability.id}" requires admin role (current role: ${auth.role ?? 'none'})`
    }
    return null
  }

  return null
}


export async function resolve(
  matchResult: MatchResult,
  params: Record<string, unknown> = {},
  options: ResolveOptions = {}
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
  const privacyError = checkPrivacy(capability, options.auth)
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
        return await resolveApi(resolver, enrichedParams, options, sessionParamNames)

      case 'nav':
        return resolveNav(resolver, enrichedParams)

      case 'hybrid': {
        logger.debug('Hybrid resolver — running API and nav in parallel')
        const [apiResult, navResult] = await Promise.all([
          resolveApi(resolver.api as ApiResolver, enrichedParams, options, sessionParamNames),
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
   */
async function resolveApi(
  resolver: ApiResolver | Omit<ApiResolver, 'type'>,
  params: Record<string, unknown>,
  options: ResolveOptions,
  sessionParamNames: Set<string> = new Set()
): Promise<ResolveResult> {
  const startTime = Date.now()
  const retries   = options.retries  ?? 0
  const timeoutMs = options.timeoutMs ?? 5000

  const apiCalls: ApiCallResult[] = resolver.endpoints.map(endpoint => {
    // Build per-endpoint params — only inject session params if this
    // specific endpoint has the placeholder. Prevents userId leaking
    // as ?user_id=xyz on endpoints that don't use it in their path.
    const endpointParams = { ...params }
    for (const name of sessionParamNames) {
      if (!endpoint.path.includes(`{${name}}`)) {
        delete endpointParams[name]  // strip session param — not in this endpoint's path
      }
    }
    return {
      method: endpoint.method,
      url: buildUrl(options.baseUrl ?? '', endpoint.path, endpointParams),
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
          const effectiveRetries = (options.retryAllMethods || SAFE_METHODS.has(call.method))
            ? retries
            : 0
        let lastErr: unknown
        for (let attempt = 0; attempt <= effectiveRetries; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetchFn(call.url, {
          method: call.method,
          headers: options.headers ?? {},
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

  try {
    const responses = await Promise.all(apiCalls.map(c => fetchWithRetry(c)))

    const failedIdx = responses.findIndex(r => !r.ok)
    if (failedIdx !== -1) {
      const failed = responses[failedIdx]
      return {
        success: false, resolverType: 'api', apiCalls,
        durationMs: Date.now() - startTime,
        error: `API request failed: ${failed.status} ${failed.statusText}`,
      }
    }

    const enrichedCalls = await Promise.all(
      responses.map(async (res, i) => {
        let data: unknown = undefined
        try {
          const text = await res.text()
          data = text ? JSON.parse(text) : undefined
        } catch { /* non-JSON response */ }
        return { ...apiCalls[i], status: res.status, data }
      })
    )

    logger.debug(`API calls completed in ${Date.now() - startTime}ms`)
    return { success: true, resolverType: 'api', apiCalls: enrichedCalls, durationMs: Date.now() - startTime }

  } catch (err) {
    return {
      success: false, resolverType: 'api', apiCalls,
      durationMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function validateNavParam(key: string, value: string): void {
  if (!/^[a-zA-Z0-9_\-]+$/.test(value)) {
    throw new Error(
      `Nav param "${key}" contains invalid characters: "${value}". ` +
      `Only alphanumeric, hyphens, and underscores are allowed.`
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
  // This mirrors the allowlist validation already applied in resolveNav().
  if (!/^[a-zA-Z0-9_\-.:@]+$/.test(value)) {
    throw new Error(
      `API path param "${key}" contains invalid characters: "${value}". ` +
      `Only alphanumeric, hyphens, underscores, dots, colons, and @ are allowed.`
    )
  }
}

// Both buildUrl (API) and resolveNav (nav) validate path param values against
// an allowlist before substitution — prevents path traversal via unencoded slashes.
function buildUrl(
  baseUrl: string,
  urlPath: string,
  params: Record<string, unknown>
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
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')

  return qs ? `${base}?${qs}` : base
}
