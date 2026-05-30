import * as fs from 'fs'
import * as path from 'path'
import { logger } from './logger'
import type { CapmanConfig, Capability, CapabilityParam, HttpMethod } from './types'

// ─── OpenAPI Types (minimal subset we need) ───────────────────────────────────

interface OpenAPISpec {
  openapi?: string
  swagger?: string
  info:     { title: string; version?: string; description?: string }
  servers?: Array<{ url: string }>
  host?:     string
  basePath?: string
  schemes?:  string[]
  paths:    Record<string, PathItem>
  components?: { schemas?: Record<string, Schema>; securitySchemes?: Record<string, SecurityScheme> }
  definitions?: Record<string, Schema>
  securityDefinitions?: Record<string, SecurityScheme>
  security?: Array<Record<string, string[]>>
}

interface PathItem {
  get?:    Operation
  post?:   Operation
  put?:    Operation
  patch?:  Operation
  delete?: Operation
}

interface Operation {
  operationId?: string
  summary?:     string
  description?: string
  tags?:        string[]
  security?:    Array<Record<string, string[]>>
  parameters?:  Parameter[]
  requestBody?: RequestBody
  responses?:   Record<string, Response>
}

interface Parameter {
  name:        string
  in:          'path' | 'query' | 'header' | 'cookie' | 'body' | 'formData'
  description?: string
  required?:   boolean
  schema?:     { type?: string }
  type?:       string
}

interface RequestBody {
  content?: Record<string, { schema?: Schema }>
}

interface Schema {
  type?:       string
  properties?: Record<string, { type?: string; description?: string }>
  required?:   string[]
}

interface Response {
  description?: string
}

interface SecurityScheme {
  type:   string
  scheme?: string
  in?:    string
  name?:  string
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export interface ParseResult {
  config:    CapmanConfig
  stats: {
    total:           number
    skipped:         number   // truly unrecoverable — no method, no path (should be zero in practice)
    autoSynthesized: number   // capabilities where description was missing and was synthesized from path + method
    warnings:        string[]
  }
}

export async function parseOpenAPI(
  specPathOrUrl: string
): Promise<ParseResult> {
  const spec = await loadSpec(specPathOrUrl)
  return convertSpec(spec)
}

// ─── Load spec from file or URL ───────────────────────────────────────────────

async function loadSpec(source: string): Promise<OpenAPISpec> {
  // URL
  if (source.startsWith('http://') || source.startsWith('https://')) {
    logger.info(`Fetching OpenAPI spec from: ${source}`)
    const controller = new AbortController()
    const timer      = setTimeout(() => controller.abort(), 10_000)
      // eslint-disable-next-line prefer-const
      let res: Awaited<ReturnType<typeof fetch>>
      try {
        res = await fetch(source, { signal: controller.signal })
        clearTimeout(timer)
      } catch (err) {
        clearTimeout(timer)
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error(`Timed out fetching spec from ${source} (10s limit)`)
        }
        throw err
     }
    if (!res.ok) throw new Error(`Failed to fetch spec: ${res.status} ${res.statusText}`)
    const text = await res.text()
    return parseSpecText(text, source)
  }

  // Local file
  const cwd = process.cwd()
  const resolved = path.resolve(cwd, source)
  // Guard against path traversal — same check used by FileCache and FileLearningStore.
  // Prevents parseOpenAPI('../../etc/passwd') from reading arbitrary files when
  // the source argument comes from user input (CLI args, UI, CI scripts).
  const allowedPrefix = cwd === '/' ? '/' : cwd + path.sep
  if (!resolved.startsWith(allowedPrefix)) {
    throw new Error(
      `Spec path "${source}" resolves outside the working directory.\n` +
      `Resolved: ${resolved}\nAllowed:  ${cwd}`
    )
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`Spec file not found: ${resolved}`)
  }
  logger.info(`Reading OpenAPI spec from: ${resolved}`)
  const text = await fs.promises.readFile(resolved, 'utf-8')
  return parseSpecText(text, source)
}

function parseSpecText(text: string, source: string): OpenAPISpec {
  // Try JSON first
  try { return JSON.parse(text) } catch {}

        // Try YAML — only if yaml package available
        try {
          const yaml = require('js-yaml')
          return yaml.load(text) as OpenAPISpec
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          // Distinguish "module not found" from actual YAML parse errors
          const code = (err as NodeJS.ErrnoException).code
          if (code !== 'MODULE_NOT_FOUND') {
            throw new Error(`YAML parse error in "${source}": ${msg}`)
          }
          // js-yaml not installed — fall through to extension check
          if (source.endsWith('.yaml') || source.endsWith('.yml')) {
            throw new Error(
              'YAML spec detected but js-yaml is not installed.\n' +
              'Install it: npm install js-yaml\n' +
              'Or convert your spec to JSON first.'
      )
    }
  }

  throw new Error('Could not parse spec — must be valid JSON or YAML')
}

// ─── Convert OpenAPI spec to CapmanConfig ─────────────────────────────────────

function convertSpec(spec: OpenAPISpec): ParseResult {
  const warnings: string[] = []
  const capabilities: Capability[] = []
  let skipped         = 0
  let autoSynthesized = 0

  // Determine base URL
  const baseUrl = extractBaseUrl(spec)

  // Detect global security schemes
  const securitySchemes = spec.components?.securitySchemes
    ?? spec.securityDefinitions
    ?? {}

  const hasGlobalAuth = Object.keys(securitySchemes).some(k => {
    const s = securitySchemes[k]
    return s.type === 'http' || s.type === 'apiKey' || s.type === 'oauth2'
  })

  // Convert each path + method
  for (const [urlPath, pathItem] of Object.entries(spec.paths ?? {})) {
    const methods: Array<[HttpMethod, Operation]> = []

    if (pathItem.get)    methods.push(['GET',    pathItem.get])
    if (pathItem.post)   methods.push(['POST',   pathItem.post])
    if (pathItem.put)    methods.push(['PUT',    pathItem.put])
    if (pathItem.patch)  methods.push(['PATCH',  pathItem.patch])
    if (pathItem.delete) methods.push(['DELETE', pathItem.delete])

    for (const [method, op] of methods) {
      const result = convertOperation(urlPath, method, op, hasGlobalAuth, securitySchemes)

      if (!result) {
        // Truly unrecoverable — convertOperation only returns null when it
        // cannot determine a method or path at all, which should never happen
        // for a valid PathItem entry.
        skipped++
        warnings.push(`Skipped ${method} ${urlPath} — could not determine endpoint shape`)
        continue
      }

      if ((result as Capability & { _synthesized?: true })._synthesized) {
        autoSynthesized++
        warnings.push(
          `Auto-synthesized: ${method} ${urlPath} — no description or summary found in spec. ` +
          `Review "${result.id}" in capman.config.js and improve the description + examples.`
        )
        delete (result as Capability & { _synthesized?: true })._synthesized
      }

      // De-conflict duplicate IDs — loop until the candidate ID is unique.
      // A single find() check is insufficient: if two operations both produce
      // `get_user`, the second becomes `get_user_get`. A third `get_user` would
      // then collide with `get_user_get` only when it also uses GET — the general
      // multi-collision case is only caught by looping.
      let candidateId = result.id
      let dedupeCount = 0
      while (capabilities.find(c => c.id === candidateId)) {
        dedupeCount++
        candidateId = `${result.id}_${method.toLowerCase()}${dedupeCount > 1 ? `_${dedupeCount}` : ''}`
      }
      if (candidateId !== result.id) {
        warnings.push(`Duplicate ID resolved: ${result.id} → ${candidateId}`)
        result.id = candidateId
      }

      capabilities.push(result)
    }
  }

  const config: CapmanConfig = {
    app: sanitizeAppName(spec.info.title),
    baseUrl,
    capabilities,
  }

  return {
    config,
    stats: {
      total:    capabilities.length,
      skipped,
      autoSynthesized,
      warnings,
    },
  }
}

// ─── Convert single operation ─────────────────────────────────────────────────

function convertOperation(
  urlPath:      string,
  method:       HttpMethod,
  op:           Operation,
  hasGlobalAuth: boolean,
  securitySchemes: Record<string, SecurityScheme>
): Capability | null {
  // Build capability ID
  const id = op.operationId
    ? toSnakeCase(op.operationId)
    : pathToId(method, urlPath)

  // Name and description.
  // Use || instead of ?? so empty strings ("") fall through to the next
  // option — ?? only catches null/undefined, and many auto-generated specs
  // set description/summary to "" rather than omitting them entirely.
  const rawDescription = (op.description || op.summary || '').trim()
  const rawName        = (op.summary || op.description || '').trim()

  // If there is genuinely no human-written description, synthesize one from
  // the path + method + tags. The capability is still generated — it just
  // gets flagged so the developer knows to review it.
  const synthesized = rawDescription.length < 5
  const description = synthesized
    ? synthesizeDescription(method, urlPath, op)
    : rawDescription
  const name = rawName.length >= 2 ? rawName : toHumanName(id)

  // Extract params
  const params = extractParams(op)

  // Determine privacy scope
  const privacyLevel = inferPrivacy(op, hasGlobalAuth, securitySchemes)

  // Build examples from path pattern
  const examples = generateExamples(name, description, params)

  // Build returns from response descriptions
  const returns = inferReturns(op, urlPath)

  const capability = {
    id,
    name,
    description,
    examples,
    params,
    returns,
    resolver: {
      type: 'api' as const,
      endpoints: [{ method, path: urlPath }],
    },
    privacy: { level: privacyLevel },
    ...(synthesized ? { _synthesized: true as const } : {}),
  }

  return capability as Capability
}

// ─── Synthesize description from path + method when spec has none ─────────────
//
// Called only when op.description and op.summary are both absent or too short
// (< 5 chars). Produces a readable sentence good enough for BM25 keyword
// matching and clearly signals to the developer that it needs review.
//
// Handles three path shapes:
//
//   Shape 1 — collection endpoint
//     GET  /v1/orders              → "List orders"
//     POST /v1/orders              → "Create order"
//
//   Shape 2 — singleton sub-resource (no trailing param but embedded in a
//   nested path, e.g. one discount per customer)
//     GET  /v1/customers/{id}/discount   → "Get customer discount"
//
//   Shape 3 — action verb as last segment (common in Stripe/Twilio/GitHub APIs)
//     POST /v1/charges/{id}/dispute/close  → "Close dispute"
//     POST /v1/application_fees/{id}/refund → "Refund application fee"
//
//   Shape 4 — plain singleton
//     GET    /v1/orders/{id}        → "Get order by id"
//     PUT    /v1/orders/{id}        → "Update order"
//     DELETE /v1/orders/{id}        → "Delete order"

/** Path segment words that are REST action verbs, not resource nouns. */
const ACTION_VERBS = new Set([
  'close', 'cancel', 'confirm', 'capture', 'send', 'submit', 'activate',
  'deactivate', 'approve', 'reject', 'archive', 'restore', 'pause', 'resume',
  'retry', 'void', 'expire', 'release', 'refund', 'transfer', 'verify',
  'validate', 'publish', 'unpublish', 'lock', 'unlock', 'revoke', 'finalize',
  'complete', 'checkout', 'apply', 'attach', 'detach', 'preview', 'reactivate',
  'redact', 'migrate', 'reset', 'rotate', 'revoke', 'disable', 'enable',
])

/** Version-like path prefixes that should not be treated as resource names. */
const VERSION_PREFIX_RE = /^v\d+$/i  // v1, v2, v3 …

function synthesizeDescription(
  method:  HttpMethod,
  urlPath: string,
  op:      Operation,
): string {
  const segments = urlPath.split('/').filter(Boolean)

  // Strip version prefixes (v1, v2 …) — they are routing, not resource names
  const meaningful = segments.filter(s => !VERSION_PREFIX_RE.test(s))

  const isParam    = (s: string) => s.startsWith('{')
  const resources  = meaningful.filter(s => !isParam(s))
  const params     = meaningful.filter(s =>  isParam(s))

  const lastSeg = meaningful[meaningful.length - 1] ?? ''

  // ── Shape 3: action verb as final segment ────────────────────────────────
  // e.g. POST /charges/{id}/dispute/close  → "Close dispute"
  //      POST /application_fees/{id}/refund → "Refund application fee"
  if (ACTION_VERBS.has(lastSeg)) {
    // Parent resource: the last non-param, non-verb segment before the verb
    const parentRaw = resources[resources.length - 2]   // e.g. "dispute"
      ?? resources[resources.length - 1]                // fallback
      ?? 'resource'
    const parent    = singularize(parentRaw.replace(/-|_/g, ' '))
    const verb      = capitalize(lastSeg)
    return `${verb} ${parent}`
  }

  // ── Remaining shapes: primary resource is last non-param segment ─────────
  const primaryRaw  = resources[resources.length - 1] ?? op.tags?.[0] ?? 'resource'
  const primary     = primaryRaw.replace(/-/g, ' ')

  // Secondary resource: the non-param segment one level up (for nested paths)
  const secondaryRaw = resources[resources.length - 2]
  const secondary    = secondaryRaw ? secondaryRaw.replace(/-/g, ' ') : null

  const endsWithParam = isParam(meaningful[meaningful.length - 1] ?? '')

  // "by <param>" suffix helps param extraction for GET-by-id operations
  const paramSuffix = (params.length > 0 && method === 'GET' && endsWithParam)
    ? ` by ${params[params.length - 1].slice(1, -1).replace(/_/g, ' ')}`
    : ''

  // Singleton nested resource (e.g. one discount per customer):
  // path ends with a plain word AND there are parent params → "Get X Y"
  // where X = singularized parent, Y = primary
  // Distinguish from a true collection: primary ends in 's'/'ies' → List
  const isCollection = primary.endsWith('s') && !endsWithParam && params.length > 0
  const nestedParent = (secondary !== null && params.length > 0 && !endsWithParam)
    ? singularize(secondary)
    : null

  switch (method) {
    case 'GET': {
      if (endsWithParam) {
        // Shape 4 — singleton by id: "Get order by id"
        return `Get ${singularize(primary)}${paramSuffix}`
      }
      if (nestedParent && !isCollection) {
        // Shape 2 — singleton sub-resource: "Get customer discount"
        return `Get ${nestedParent} ${primary}`
      }
      if (nestedParent && isCollection) {
        // Shape 2 — sub-collection: "List orders for customer"
        return `List ${primary} for ${nestedParent}`
      }
      // Shape 1 — top-level collection: "List orders"
      return `List ${primary}`
    }

    case 'POST':
      return `Create ${singularize(primary)}`

    case 'PUT':
    case 'PATCH': {
      const target = nestedParent
        ? `${nestedParent} ${primary}`
        : singularize(primary)
      return `Update ${target}`
    }

    case 'DELETE':
      return `Delete ${singularize(primary)}`

    default:
      return `${method} ${primary}`
  }
}

function singularize(word: string): string {
  if (word.endsWith('ies') && word.length > 4)           return word.slice(0, -3) + 'y'
  if (word.endsWith('ses') || word.endsWith('xes'))      return word.slice(0, -2)
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1)
  return word
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ─── Extract params from operation ───────────────────────────────────────────

function extractParams(op: Operation): CapabilityParam[] {
  const params: CapabilityParam[] = []

  // Path and query params
  for (const p of op.parameters ?? []) {
    if (p.in === 'header' || p.in === 'cookie') continue

    const source: CapabilityParam['source'] =
      p.in === 'path'  ? 'user_query' :
      p.in === 'query' ? 'user_query' :
      'user_query'  // body/formData (Swagger 2.x) — treat as user_query

    params.push({
      name:        toSnakeCase(p.name),
      description: p.description ?? toHumanName(p.name),
      required:    p.required ?? p.in === 'path',
      source,
    })
  }

  // Request body fields (POST/PUT/PATCH)
  const bodyContent = op.requestBody?.content
  if (bodyContent) {
    const schema = (
      bodyContent['application/json']?.schema ??
      bodyContent['*/*']?.schema
    ) as Schema | undefined

    if (schema?.properties) {
      const required = schema.required ?? []
      for (const [fieldName, field] of Object.entries(schema.properties)) {
        // Skip if already added as a path param
        if (params.find(p => p.name === toSnakeCase(fieldName))) continue
        params.push({
          name:        toSnakeCase(fieldName),
          description: field.description ?? toHumanName(fieldName),
          required:    required.includes(fieldName),
          source:      'user_query',
        })
      }
    }
  }

  return params
}

// ─── Infer privacy scope ──────────────────────────────────────────────────────

function inferPrivacy(
  op:              Operation,
  hasGlobalAuth:   boolean,
  securitySchemes: Record<string, SecurityScheme>
): 'public' | 'user_owned' | 'admin' {
  // Explicitly no security on this operation
  if (op.security !== undefined && op.security.length === 0) return 'public'

  // Check operation tags for admin hints — word-boundary match only.
  // Avoids false positives like 'manageWishlist', 'fileManager', 'managedService'
  // being classified as admin when they are user-facing operations.
  const ADMIN_PATTERN = /\b(admin|administrator|backoffice|back-office|internal|superuser)\b/i
  const tags = op.tags ?? []
  if (tags.some(t => ADMIN_PATTERN.test(t))) return 'admin'

  // Check operation ID / summary — same word-boundary pattern.
  // 'manage' alone is NOT an admin signal — too many user-facing ops use it.
  const hint = `${op.operationId ?? ''} ${op.summary ?? ''}`.toLowerCase()
  if (ADMIN_PATTERN.test(hint)) {
    return 'admin'
  }

  // If global auth exists or operation has security, it's user_owned
  if (hasGlobalAuth || (op.security && op.security.length > 0)) {
    return 'user_owned'
  }

  return 'public'
}

// ─── Generate examples ────────────────────────────────────────────────────────

function generateExamples(
  name:        string,
  description: string,
  params:      CapabilityParam[]
): string[] {
  const examples: string[] = []

  // Primary example from name
  examples.push(name)

  // Variation from description (first sentence, truncated)
  const firstSentence = description.split(/[.!?]/)[0].trim()
  if (firstSentence && firstSentence !== name && firstSentence.length < 80) {
    examples.push(firstSentence)
  }

  // Param-based example
  const required = params.filter(p => p.required && p.source === 'user_query')
  if (required.length > 0) {
    const paramNames = required.map(p => p.name.replace(/_/g, ' ')).join(' and ')
    examples.push(`${name} by ${paramNames}`)
  }

  return examples.slice(0, 3)
}

// ─── Infer returns ────────────────────────────────────────────────────────────

function inferReturns(op: Operation, urlPath: string): string[] {
  const segments = urlPath.split('/').filter(Boolean)
  const resource = segments
    .filter(s => !s.startsWith('{'))
    .pop() ?? 'data'

  return [resource.replace(/-/g, '_')]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractBaseUrl(spec: OpenAPISpec): string {
  // OpenAPI 3.x
  if (spec.servers?.length) {
    return spec.servers[0].url.replace(/\/$/, '')
  }
  // Swagger 2.x — respect declared schemes, prefer https over http
  if (spec.host) {
    const schemes = spec.schemes ?? ['https']
    const scheme  = schemes.includes('https') ? 'https' : schemes[0] ?? 'https'
    const base    = spec.basePath ?? ''
    return `${scheme}://${spec.host}${base}`.replace(/\/$/, '')
  }
  throw new Error(
    `No server URL found in OpenAPI spec — cannot determine base URL.\n` +
    `Add a "servers" entry (OpenAPI 3.x) or "host" + "basePath" (Swagger 2.x), ` +
    `or set baseUrl manually in capman.config.js after generating.`
  )
  }

function sanitizeAppName(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '_$1')
    .replace(/[-\s]+/g, '_')
    .toLowerCase()
    .replace(/^_/, '')
    .replace(/__+/g, '_')
    .replace(/_$/, '') 
}

function toHumanName(id: string): string {
  return id
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function pathToId(method: HttpMethod, urlPath: string): string {
  const segments = urlPath
    .split('/')
    .filter(Boolean)
    .map(s => s.startsWith('{') ? s.slice(1, -1) : s)
    .join('_')

  const prefix =
    method === 'GET'    ? 'get' :
    method === 'POST'   ? 'create' :
    method === 'PUT'    ? 'update' :
    method === 'PATCH'  ? 'update' :
    method === 'DELETE' ? 'delete' : 'call'

  return toSnakeCase(`${prefix}_${segments}`)
}