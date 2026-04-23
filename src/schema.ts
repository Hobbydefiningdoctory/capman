import { z } from 'zod'

// ─── Param Schema ─────────────────────────────────────────────────────────────

const CapabilityParamSchema = z.object({
  name:        z.string().min(1, 'param name is required'),
  description: z.string().min(1, 'param description is required'),
  required:    z.boolean(),
  source:      z.enum(['user_query', 'session', 'context', 'static']),
  default:     z.union([z.string(), z.number(), z.boolean()]).optional(),
})

// ─── Resolver Schemas ─────────────────────────────────────────────────────────

const ApiResolverSchema = z.object({
  type: z.literal('api'),
  endpoints: z.array(z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    path:   z.string().min(1, 'endpoint path is required'),
    params: z.array(z.string()).optional(),
  })).min(1, 'at least one endpoint is required'),
})

const NavResolverSchema = z.object({
  type:        z.literal('nav'),
  destination: z.string().min(1, 'nav destination is required'),
  hint:        z.string().optional(),
})

const HybridResolverSchema = z.object({
  type: z.literal('hybrid'),
  api: z.object({
    endpoints: z.array(z.object({
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
      path:   z.string().min(1),
      params: z.array(z.string()).optional(),
    })).min(1),
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

// ─── Capability Schema ────────────────────────────────────────────────────────

const CapabilitySchema = z.object({
  id:          z.string().min(1, 'capability id is required')
               .regex(/^[a-z0-9_]+$/, 'id must be snake_case (lowercase, numbers, underscores only)'),
  name:        z.string().min(1, 'capability name is required'),
  description: z.string()
  .min(10, 'description must be at least 10 characters for accurate matching')
  .max(500, 'description must be 500 characters or fewer'),
  examples:    z.array(z.string().max(200, 'each example must be 200 characters or fewer')).optional(),
  params:      z.array(CapabilityParamSchema),
  returns:     z.array(z.string()),
  resolver:    ResolverSchema,
  privacy:     PrivacyScopeSchema,
})

// ─── Config Schema ────────────────────────────────────────────────────────────

export const CapmanConfigSchema = z.object({
  app:          z.string().min(1, 'app name is required'),
  baseUrl:      z.string().url().optional(),
  capabilities: z.array(CapabilitySchema)
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
    return !needsBaseUrl || !!cfg.baseUrl
  },
  { message: 'baseUrl is required when any capability uses an api or hybrid resolver' }
)

// ─── Manifest Schema ──────────────────────────────────────────────────────────

export const ManifestSchema = z.object({
  version:      z.string(),
  app:          z.string().min(1),
  generatedAt:  z.string().datetime(),
  capabilities: z.array(CapabilitySchema).min(1),
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