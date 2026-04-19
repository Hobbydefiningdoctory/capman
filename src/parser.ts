import * as fs from 'fs'
import * as path from 'path'
import { logger } from './logger'
import type { CapmanConfig, Capability, CapabilityParam, HttpMethod } from './types'

// ─── OpenAPI Types (minimal subset we need) ───────────────────────────────────

interface OpenAPISpec {
  openapi?: string
  swagger?: string
  info:     { title: string; description?: string }
  servers?: Array<{ url: string }>
  host?:    string
  basePath?: string
  paths:    Record<string, PathItem>
  components?: { securitySchemes?: Record<string, SecurityScheme> }
  securityDefinitions?: Record<string, SecurityScheme>
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
    total:    number
    skipped:  number
    warnings: string[]
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
  const resolved = path.resolve(process.cwd(), source)
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
  } catch {
    // js-yaml not installed — try basic YAML detection
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
  let skipped = 0

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
        skipped++
        warnings.push(`Skipped ${method} ${urlPath} — no useful info to generate capability`)
        continue
      }

      // Check for duplicate IDs
      const existing = capabilities.find(c => c.id === result.id)
      if (existing) {
        result.id = `${result.id}_${method.toLowerCase()}`
        warnings.push(`Duplicate ID resolved: ${result.id}`)
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

  // Name and description
  const name = op.summary ?? toHumanName(id)
  const description = op.description ?? op.summary ?? `${method} ${urlPath}`

  if (description.length < 5) return null

  // Extract params
  const params = extractParams(op)

  // Determine privacy scope
  const privacyLevel = inferPrivacy(op, hasGlobalAuth, securitySchemes)

  // Build examples from path pattern
  const examples = generateExamples(name, description, params)

  // Build returns from response descriptions
  const returns = inferReturns(op, urlPath)

  return {
    id,
    name,
    description,
    examples,
    params,
    returns,
    resolver: {
      type: 'api',
      endpoints: [{ method, path: urlPath }],
    },
    privacy: { level: privacyLevel },
  }
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
      'context'

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

  // Check operation tags for admin hints
  const tags = (op.tags ?? []).map(t => t.toLowerCase())
  if (tags.some(t => t.includes('admin') || t.includes('internal'))) return 'admin'

  // Check operation ID / summary for admin hints
  const hint = `${op.operationId ?? ''} ${op.summary ?? ''}`.toLowerCase()
  if (hint.includes('admin') || hint.includes('manage') || hint.includes('internal')) {
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
  // Swagger 2.x
  if (spec.host) {
    const scheme = 'https'
    const base = spec.basePath ?? ''
    return `${scheme}://${spec.host}${base}`.replace(/\/$/, '')
  }
  return 'https://api.your-app.com'
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