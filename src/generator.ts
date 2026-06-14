import { VERSION } from './version'
import * as fs from 'fs'
import * as path from 'path'
import type { CapmanConfig, Manifest, ValidationResult } from './types'
import { validateConfig, validateManifest } from './schema'
import { logger } from './logger'

export function generate(config: CapmanConfig): Manifest {
  return {
    schemaVersion: '1.0.0',
    version:       VERSION,
    app:           config.app,
    generatedAt:   new Date().toISOString(),
    capabilities:  config.capabilities.map(sanitizeCap),
    ...(config.info ? { info: config.info } : {}),
    ...(config.tagRegistry ? { tagRegistry: config.tagRegistry } : {}),
    ...(config.servers     ? { servers:     config.servers     } : {}),
  }
}

/**
 * Strips HTML tags and common entities from text.
 * Enterprise specs (Stripe, Twilio) embed HTML in description/summary fields.
 * Raw tags poison BM25 examples and prevent clean deprecation detection.
 */
function stripHTML(text: string): string {
  return text
    .replace(/<[^>]*>?/g, ' ')     // remove tags — `>?` also catches mid-string truncated tags
    .replace(/&amp;/g,   '&')
    .replace(/&lt;/g,    '<')
    .replace(/&gt;/g,    '>')
    .replace(/&quot;/g,  '"')
    .replace(/&#039;/g,  "'")
    .replace(/&[a-z]+;/gi, ' ')    // strip remaining named entities
    .replace(/\s+/g,     ' ')
    .trim()
}

// Detects deprecation notices embedded in raw descriptions/names.
// Used in both parser.ts (at parse time) and sanitizeCap (at generate time)
// so existing pre-baked configs are also cleaned without a full re-parse.
const DEPRECATION_RE = /\b(deprecated|no longer recommended|not recommended|use .{0,60} instead|this method (is|has been) deprecated|this endpoint (is|has been) deprecated)\b/i

/**
 * Derives a clean human-readable capability name from a snake_case id.
 * Used when the original name is a deprecation notice.
 * e.g. "post_charges" → "Post Charges"
 */
function idToHumanName(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/**
 * Enforce schema length limits on a capability before it enters the manifest.
 * Also strips HTML and detects deprecation notices — cleans up existing configs
 * that were generated before the parser had these fixes, without requiring
 * a full re-parse.
 */
function sanitizeCap(cap: CapmanConfig['capabilities'][number]): CapmanConfig['capabilities'][number] {
  const cleanName = stripHTML(cap.name)
  const cleanDesc = stripHTML(cap.description)

  // Detect if the name or description IS a deprecation notice (not a real name)
  const isDeprecated   = DEPRECATION_RE.test(cleanDesc) || DEPRECATION_RE.test(cleanName)
  const nameIsNotice   = isDeprecated && DEPRECATION_RE.test(cleanName)
  // Preserve explicit lifecycle from config; auto-detect only when absent
  const lifecycle      = cap.lifecycle ?? (isDeprecated ? { status: 'deprecated' as const } : undefined)

  return {
    ...cap,
    name:        nameIsNotice ? idToHumanName(cap.id) : truncate(cleanName, 200),
    description: truncate(isDeprecated && DEPRECATION_RE.test(cleanDesc)
      ? idToHumanName(cap.id)
      : cleanDesc, 500),
    ...(cap.examples
      ? { examples: cap.examples.map(e => truncate(stripHTML(e), 200)) }
      : {}),
    ...(lifecycle ? { lifecycle } : {}),
  }
}

/**
 * Truncate text to at most `max` characters, preferring a sentence boundary,
 * then a word boundary, appending `…` when truncation occurs.
 */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text

  // Try to cut at the last sentence boundary (., !, ?) within the budget,
  // but only if it keeps at least half the budget (avoids cutting too early)
  const window = text.slice(0, max)
  const sentenceCut = window.search(/[.!?][^.!?]*$/)
  if (sentenceCut > max * 0.5) return text.slice(0, sentenceCut + 1).trimEnd()

  // Fall back to the last word boundary
  const wordCut = window.slice(0, max - 1).lastIndexOf(' ')
  if (wordCut > 0) return text.slice(0, wordCut).trimEnd() + '…'

  // Last resort: hard cut
  return text.slice(0, max - 1) + '…'
}

export function loadConfig(configPath?: string): CapmanConfig {
  const candidates = configPath
    ? [configPath]
    : ['capman.config.js', 'capman.config.json']

  // If a specific path was given but doesn't exist — clear error
  if (configPath) {
    const resolved = path.resolve(process.cwd(), configPath)
    if (!fs.existsSync(resolved)) {
      throw new Error(
        `Config file not found at: ${resolved}\n` +
        `Check the path and try again.`
      )
    }
  }

  for (const candidate of candidates) {
    const resolved = path.resolve(process.cwd(), candidate)
    if (fs.existsSync(resolved)) {
      let raw: unknown

      // Catch syntax errors in config file

      // Note: require() only works with CJS config files (.js, .json)
      // ESM config files (.mjs or "type": "module") are not supported.
      // Use a CJS config file or convert with: module.exports = { ... }
      // Full ESM config support is planned for v0.5.
    
      try {
        // Bust the module cache before loading — require() caches by resolved path,
        // so a second call without this returns the stale version from the first call.
        // This matters in watch mode and test suites that change config between calls.
        delete require.cache[require.resolve(resolved)]
        const mod = require(resolved)
        raw = mod.default ?? mod
      } catch (err: unknown) {
        const code    = (err as NodeJS.ErrnoException).code
        const message = err instanceof Error ? err.message : String(err)

        // ERR_REQUIRE_ESM — file is an ES module (Node v12–v21)
        // On Node v22+, the error message changed but code remains ERR_REQUIRE_ESM
        // for .mjs files; .js files in ESM packages may show a different message.
        const isESM = code === 'ERR_REQUIRE_ESM' ||
          message.includes('require() of ES Module') ||
          message.includes('must use import to load ES Module')

        if (isESM) {
          throw new Error(
            `Config file "${resolved}" is an ES module but capman requires CommonJS.\n` +
            `Solutions:\n` +
            `  1. Rename to capman.config.cjs\n` +
            `  2. Change to: module.exports = { ... }\n` +
            `  3. Remove "type": "module" from your package.json`
          )
        }

        throw new Error(
          `Failed to load config at ${resolved}:\n` +
          `  ${message}\n\n` +
          `Check your config file for syntax errors.`
        )
      }

      // Catch invalid config structure
      const check = validateConfig(raw)
      if (!check.valid) {
        throw new Error(
          `Invalid capman config at ${resolved}:\n` +
          check.errors.map(e => `  • ${e}`).join('\n') + '\n\n' +
          `Run: node bin/capman.js init  to see a valid example config.`
        )
      }

      return raw as CapmanConfig
    }
  }

  // No config found at all
  throw new Error(
    `No capman config file found.\n\n` +
    `Expected one of:\n` +
    candidates.map(c => `  • ${c}`).join('\n') + '\n\n' +
    `Run: node bin/capman.js init  to create one.`
  )
}

/**
 * Result returned by `writeManifest()`.
 *
 * **Breaking change from v0.6.x:** the function previously returned `string`
 * (the resolved output path). It now returns this object. Callers that stored
 * the return value as `string` must update to use `.path`:
 *
 * ```ts
 * // Before
 * const p: string = writeManifest(manifest)
 *
 * // After
 * const { path, bytes } = writeManifest(manifest)
 * ```
 *
 * Callers that ignored the return value are unaffected.
 */
export interface WriteManifestResult {
  /** Absolute path to the written manifest file. */
  path:  string
  /** Size of the written file in bytes (UTF-8 encoded). */
  bytes: number
}

export function writeManifest(manifest: Manifest, outputPath = 'manifest.json'): WriteManifestResult {
  const cwd           = process.cwd()
  const resolved      = path.resolve(cwd, outputPath)
  const allowedPrefix = cwd === '/' ? '/' : cwd + path.sep
  if (!resolved.startsWith(allowedPrefix)) {
    throw new Error(
      `writeManifest: output path "${outputPath}" resolves outside the working directory.\n` +
      `Resolved: ${resolved}\nAllowed:  ${cwd}`
    )
  }

  // Serialize once — reused for both the write and the byte count.
  // JSON.stringify(manifest, null, 2) called twice would waste CPU on large
  // manifests (e.g. Stripe: 582 capabilities ≈ 750 KB).
  const json  = JSON.stringify(manifest, null, 2)
  // Buffer.byteLength gives the true UTF-8 byte count, which matches what
  // fs.writeFileSync will actually write (string default encoding is utf-8).
  const bytes = Buffer.byteLength(json, 'utf8')

  // Write atomically via tmp → rename — same pattern used by FileCache and
  // FileLearningStore. A crash or SIGKILL mid-write leaves the .tmp file, not
  // a truncated manifest.json, so the next readManifest() can still parse it.
  const tmp = `${resolved}.tmp`
  fs.writeFileSync(tmp, json)
  fs.renameSync(tmp, resolved)

  // Post-write verification — on some containerised/overlay filesystems,
  // renameSync() silently does nothing instead of throwing when the rename
  // fails (e.g. cross-device move, read-only overlay). Without this check,
  // the CLI prints "✓ Manifest written" while the file never arrived.
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `writeManifest: file write appeared to succeed but "${resolved}" does not exist.\n` +
      `The .tmp file may still be present at "${tmp}".\n` +
      `Check filesystem permissions and available disk space.`
    )
  }

  return { path: resolved, bytes }
}

export function readManifest(manifestPath = 'manifest.json'): Manifest {
  const resolved = path.resolve(process.cwd(), manifestPath)
  if (!fs.existsSync(resolved)) {
    throw new Error(`No manifest found at ${resolved}. Run: node bin/capman.js generate`)
  }
  const raw = JSON.parse(fs.readFileSync(resolved, 'utf-8'))

  const check = validateManifest(raw)
  if (!check.valid) {
    throw new Error(
      `Invalid manifest at ${resolved}:\n` +
      check.errors.map(e => `  • ${e}`).join('\n')
    )
  }

  return raw as Manifest
}

export function validate(manifest: Manifest): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Delegate error checking to Zod
  const zodResult = validateManifest(manifest)
  errors.push(...zodResult.errors)

  // Warnings that Zod doesn't cover
  for (const cap of manifest.capabilities ?? []) {
    if (!cap.examples?.length) {
      const msg = `Capability "${cap.id}" has no examples — adding examples improves matching`
      warnings.push(msg)
      logger.warn(msg)
    }
    if (!cap.returns?.length) {
      const msg = `Capability "${cap.id}" has no "returns" declaration`
      warnings.push(msg)
      logger.warn(msg)
    }
  }

  if (errors.length > 0) {
    logger.error(`Manifest validation failed — ${errors.length} error(s)`)
    errors.forEach(e => logger.error(e))
  }

  return { valid: errors.length === 0, errors, warnings }
}
export function generateStarterConfig(): string {
  return `// capman.config.js
// Auto-generated starter config — edit before use

module.exports = {
  app: 'my-app',
  baseUrl: 'https://api.your-app.com',

  // Optional metadata block — used for documentation and provenance
  info: {
    title:       'My App',
    description: 'Brief description of what this app does',
    version:     '1.0.0',
    homepage:    'https://your-app.com',
    contact:     { name: 'Your Name', email: 'you@your-app.com' },
    license:     { name: 'MIT' },
  },

  capabilities: [
    {
      id: 'get_resource',
      name: 'Get a resource',
      description: 'Fetch a specific resource by name, ID, or filter from the app.',
      examples: [
        'Show me the resource details',
        'Find resource by ID',
        'Look up resource by name',
      ],
      params: [
        {
          name: 'resource_id',
          description: 'The ID or name of the resource to fetch',
          required: true,
          source: 'user_query',
        },
      ],
      returns: ['resource', 'metadata'],
      resolver: {
        type: 'api',
        endpoints: [{ method: 'GET', path: '/resources/{resource_id}' }],
      },
      privacy: { level: 'public', note: 'No auth required' },
    },

    {
      id: 'navigate_to_screen',
      name: 'Navigate to a screen',
      description: 'Route the user to a specific page or section in the app.',
      examples: [
        'Take me to the dashboard',
        'Open settings',
        'Go to my profile',
      ],
      params: [
        {
          name: 'destination',
          description: 'The screen or page to navigate to',
          required: true,
          source: 'user_query',
        },
      ],
      returns: ['deep_link'],
      resolver: { type: 'nav', destination: '{destination}' },
      privacy: { level: 'public' },
    },

    {
      id: 'get_user_data',
      name: 'Get user data',
      description: 'Retrieve data belonging to the currently authenticated user.',
      examples: [
        'Show my account details',
        'What is my current plan?',
        'Show my recent activity',
      ],
      params: [
        {
          name: 'user_id',
          description: 'Current user ID',
          required: true,
          source: 'session',
        },
      ],
      returns: ['user_data'],
      resolver: {
        type: 'api',
        endpoints: [{ method: 'GET', path: '/users/{user_id}' }],
      },
      privacy: { level: 'user_owned', note: 'Requires auth — scoped to current user only' },
    },
  ],
}
`
}