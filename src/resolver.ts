import { logger } from './logger'
import type { MatchResult, ResolveResult, ApiResolver, NavResolver, ApiCallResult } from './types'

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
  // Inject auth.userId into any params marked as source: 'session'
  const enrichedParams = { ...params }
      if (options.auth?.userId !== undefined) {
        for (const param of capability.params) {
          if (param.source === 'session') {
            enrichedParams[param.name] = options.auth.userId!
            logger.debug(`Injected session param "${param.name}" = "${options.auth.userId}"`)
          }
        }
    }

  const resolver = capability.resolver
  logger.info(`Resolving capability "${capability.id}" via ${resolver.type} resolver`)
  logger.debug(`Params: ${JSON.stringify(params)}`)
  logger.debug(`Options: baseUrl=${options.baseUrl} dryRun=${options.dryRun}`)

  try {
    switch (resolver.type) {
      case 'api':
        return await resolveApi(resolver, enrichedParams, options)

      case 'nav':
        return resolveNav(resolver, enrichedParams)

      case 'hybrid': {
        logger.debug('Hybrid resolver — running API and nav in parallel')
        const [apiResult, navResult] = await Promise.all([
          resolveApi(resolver.api as ApiResolver, enrichedParams, options),
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


async function resolveApi(
  resolver: ApiResolver | Omit<ApiResolver, 'type'>,
  params: Record<string, unknown>,
  options: ResolveOptions
): Promise<ResolveResult> {
  const startTime = Date.now()
  const retries   = options.retries  ?? 0
  const timeoutMs = options.timeoutMs ?? 5000

  const apiCalls: ApiCallResult[] = resolver.endpoints.map(endpoint => ({
    method: endpoint.method,
    url: buildUrl(options.baseUrl ?? '', endpoint.path, params),
    params,
  }))

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
  async function fetchWithRetry(call: ApiCallResult): Promise<Response> {
    let lastErr: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetchFn(call.url, {
          method: call.method,
          headers: options.headers ?? {},
          signal: controller.signal,
          body: ['POST', 'PUT', 'PATCH'].includes(call.method)
            ? JSON.stringify(call.params)
            : undefined,
        })
        clearTimeout(timer)
        return res
      } catch (err) {
        clearTimeout(timer)
        lastErr = err
        const isTimeout = err instanceof Error && err.name === 'AbortError'
        if (attempt < retries) {
          logger.warn(`Request failed (attempt ${attempt + 1}/${retries + 1}) — retrying: ${isTimeout ? 'timeout' : err}`)
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

function resolveNav(
  resolver: NavResolver | Omit<NavResolver, 'type'>,
  params: Record<string, unknown>
): ResolveResult {
  let destination = resolver.destination
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue
    destination = destination.replace(`{${key}}`, encodeURIComponent(String(value)))
  }
  return { success: true, resolverType: 'nav', navTarget: destination }
}

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
      resolved = resolved.replace(`{${key}}`, encodeURIComponent(String(value)))
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
