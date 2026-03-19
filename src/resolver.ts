import type { MatchResult, ResolveResult, ApiResolver, NavResolver } from './types'
import { logger } from './logger'

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
  /** Auth context — required for user_owned and admin capabilities */
  auth?: AuthContext
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

  const resolver = capability.resolver
  logger.info(`Resolving capability "${capability.id}" via ${resolver.type} resolver`)
  logger.debug(`Params: ${JSON.stringify(params)}`)
  logger.debug(`Options: baseUrl=${options.baseUrl} dryRun=${options.dryRun}`)

  try {
    switch (resolver.type) {
      case 'api':
        return await resolveApi(resolver, params, options)

      case 'nav':
        return resolveNav(resolver, params)

      case 'hybrid': {
        logger.debug('Hybrid resolver — running API and nav in parallel')
        const [apiResult, navResult] = await Promise.all([
          resolveApi(resolver.api as ApiResolver, params, options),
          Promise.resolve(resolveNav(resolver.nav as NavResolver, params)),
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
  const apiCalls = resolver.endpoints.map(endpoint => ({
    method: endpoint.method,
    url: buildUrl(options.baseUrl ?? '', endpoint.path, params),
    params,
  }))

  if (options.dryRun) {
    return { success: true, resolverType: 'api', apiCalls }
  }

  const fetchFn = options.fetch ?? globalThis.fetch
  if (!fetchFn) {
    return {
      success: true,
      resolverType: 'api',
      apiCalls,
      error: 'No fetch available — returning call plan only',
    }
  }

  await Promise.all(
    apiCalls.map(c => fetchFn(c.url, {
      method: c.method,
      headers: options.headers ?? {},
      body: ['POST', 'PUT', 'PATCH'].includes(c.method)
        ? JSON.stringify(c.params)
        : undefined,
    }))
  )

  return { success: true, resolverType: 'api', apiCalls }
}

function resolveNav(
  resolver: NavResolver | Omit<NavResolver, 'type'>,
  params: Record<string, unknown>
): ResolveResult {
  let destination = resolver.destination
  for (const [key, value] of Object.entries(params)) {
    destination = destination.replace(`{${key}}`, String(value))
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
