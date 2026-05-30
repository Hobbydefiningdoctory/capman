import { z } from 'zod'

// ─── Param Schema ─────────────────────────────────────────────────────────────

const CapabilityParamSchema = z.object({
  name:        z.string().min(1, 'param name is required'),
  description: z.string().min(1, 'param description is required'),
  required:    z.boolean(),
  source:      z.enum(['user_query', 'session']),
  pattern:     z.string().optional(),
  type:        z.enum(['string', 'number', 'boolean', 'date', 'email', 'url', 'enum', 'object']).optional(),
  enum:        z.array(z.string()).optional(),
  example:     z.string().optional(),
}).refine(
  p => !(p.type === 'enum' && (!p.enum || p.enum.length === 0)),
  { message: 'enum values required when type is "enum"' }
)

// ─── Resolver Schemas ─────────────────────────────────────────────────────────

const EndpointSchema = z.object({
  method:          z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
  path:            z.string().min(1, 'endpoint path is required'),
  params:          z.array(z.string()).optional(),
  idempotent:      z.boolean().optional(),
  idempotencyKey:  z.string().optional(),
})

const ApiResolverSchema = z.object({
  type:      z.literal('api'),
  endpoints: z.array(EndpointSchema).min(1, 'at least one endpoint is required'),
})

const NavResolverSchema = z.object({
  type:        z.literal('nav'),
  destination: z.string().min(1, 'nav destination is required'),
  hint:        z.string().optional(),
})

const HybridResolverSchema = z.object({
  type: z.literal('hybrid'),
  api: z.object({
    endpoints: z.array(EndpointSchema).min(1),
  }),
  nav: z.object({
    destination: z.string().min(1),
    hint:        z.string().optional(),
  }),
})

const ResolverSchema = z.discriminatedUnion('type', [
  ApiResolverSchema,
  NavResolverSchema,
  HybridResolverSchema,
])

// ─── Privacy Schema ───────────────────────────────────────────────────────────

const PrivacyScopeSchema = z.object({
  level: z.enum(['public', 'user_owned', 'admin']),
  note:  z.string().optional(),
})

const LifecycleInfoSchema = z.object({
  status:       z.enum(['stable', 'beta', 'experimental', 'deprecated']),
  deprecatedAt: z.string().datetime().optional(),
  sunsetAt:     z.string().datetime().optional(),
  successor:    z.string().optional(),
  note:         z.string().optional(),
})

const MatchHintSchema = z.object({
  preferredMode: z.enum(['cheap', 'balanced', 'accurate']).optional(),
})

const CapabilityErrorSchema = z.object({
  code:        z.string().min(1, 'error code is required'),
  description: z.string().min(1, 'error description is required'),
  httpStatus:  z.number().int().min(400).max(599).optional(),
  retryable:   z.boolean().optional(),
})

// ─── Capability Schema ────────────────────────────────────────────────────────

// Shared structural fields — no length limits.
// Used for config validation where the user's source-of-truth may contain
// verbose descriptions from imported OpenAPI specs (e.g. Stripe descriptions
// can exceed 2000 chars). The generator's sanitizeCap() enforces limits before
// the data reaches the manifest.
const CapabilityBaseSchema = z.object({
  id:          z.string().min(1, 'capability id is required')
               .regex(/^[a-z0-9_]+$/, 'id must be snake_case (lowercase, numbers, underscores only)'),
  name:        z.string().min(1, 'capability name is required'),
  description: z.string()
               .min(10, 'description must be at least 10 characters for accurate matching'),
  examples:    z.array(z.string()).optional(),
  params:      z.array(CapabilityParamSchema),
  returns:     z.array(z.string()),
  resolver:    ResolverSchema,
  privacy:     PrivacyScopeSchema,
  lifecycle: LifecycleInfoSchema.optional(),
  tags:      z.array(z.string().min(1)).optional(),
  errors:    z.array(CapabilityErrorSchema).optional(),
  matchHint: MatchHintSchema.optional(),
})

// Manifest-level schema adds length limits — the manifest is the compiled output
// consumed by the engine, where oversized strings degrade BM25 matching quality.
const CapabilitySchema = CapabilityBaseSchema.extend({
  description: z.string()
               .min(10, 'description must be at least 10 characters for accurate matching')
               .max(500, 'description must be 500 characters or fewer'),
  examples:    z.array(z.string().max(200, 'each example must be 200 characters or fewer')).optional(),
})

const ServerSchema = z.object({
  url:          z.string().url('server url must be a valid URL'),
  description:  z.string().optional(),
  environment:  z.string().optional(),
})

// ─── ManifestInfo Schema ──────────────────────────────────────────────────────

const ManifestInfoSchema = z.object({
  title:       z.string().optional(),
  description: z.string().optional(),
  version:     z.string().optional(),
  homepage:    z.string().url().optional(),
  contact: z.object({
    name:  z.string().optional(),
    email: z.string().email().optional(),
    url:   z.string().url().optional(),
  }).optional(),
  license: z.object({
    name: z.string().min(1, 'license name is required'),
    url:  z.string().url().optional(),
  }).optional(),
})

// ─── Config Schema ────────────────────────────────────────────────────────────

export const CapmanConfigSchema = z.object({
  app:          z.string().min(1, 'app name is required'),
  baseUrl:      z.string().url().optional(),
  info:         ManifestInfoSchema.optional(),
  servers:      z.array(ServerSchema).optional(),
  tagRegistry:  z.record(z.object({ description: z.string() })).optional(),
  capabilities: z.array(CapabilityBaseSchema)
    .min(1, 'at least one capability is required')
    .refine(
      caps => new Set(caps.map(c => c.id)).size === caps.length,
      'capability ids must be unique'
    ),
}).refine(
  cfg => {
    const needsBaseUrl = cfg.capabilities.some(
      c => c.resolver.type === 'api' || c.resolver.type === 'hybrid'
    )
    return !needsBaseUrl || !!cfg.baseUrl || (cfg.servers?.length ?? 0) > 0
  },
  { message: 'baseUrl is required when any capability uses an api or hybrid resolver' }
)

// ─── Manifest Schema ──────────────────────────────────────────────────────────

export const ManifestSchema = z.object({
  schemaVersion: z.string().min(1, 'schemaVersion is required'),
  version:       z.string(),
  app:           z.string().min(1),
  generatedAt:   z.string().datetime(),
  capabilities:  z.array(CapabilitySchema).min(1),
  tagRegistry:   z.record(z.object({ description: z.string() })).optional(),
  servers:      z.array(ServerSchema).optional(),
  info:          ManifestInfoSchema.optional(),
})

// ─── Validation helpers ───────────────────────────────────────────────────────

export type ZodValidationResult = {
  valid: boolean
  errors: string[]
}

export function validateConfig(config: unknown): ZodValidationResult {
  const result = CapmanConfigSchema.safeParse(config)
  if (result.success) return { valid: true, errors: [] }

  const errors = result.error.errors.map(e =>
    `${e.path.join('.')} — ${e.message}`
  )
  return { valid: false, errors }
}

export function validateManifest(manifest: unknown): ZodValidationResult {
  const result = ManifestSchema.safeParse(manifest)
  if (result.success) return { valid: true, errors: [] }

  const errors = result.error.errors.map(e =>
    `${e.path.join('.')} — ${e.message}`
  )
  return { valid: false, errors }
}