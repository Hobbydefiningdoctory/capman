
import * as fs from 'fs'
import * as path from 'path'
import type { CapmanConfig, Manifest, ValidationResult } from './types'
import { validateConfig, validateManifest } from './schema'

export function generate(config: CapmanConfig): Manifest {
  return {
    version: require('../package.json').version,
    app: config.app,
    generatedAt: new Date().toISOString(),
    capabilities: config.capabilities,
  }
}

export function loadConfig(configPath?: string): CapmanConfig {
  const candidates = configPath
    ? [configPath]
    : ['capman.config.js', 'capman.config.json']

  for (const candidate of candidates) {
    const resolved = path.resolve(process.cwd(), candidate)
    if (fs.existsSync(resolved)) {
      const mod = require(resolved)
      const raw = mod.default ?? mod

      const check = validateConfig(raw)
      if (!check.valid) {
        throw new Error(
          `Invalid capman config at ${resolved}:\n` +
          check.errors.map(e => `  • ${e}`).join('\n')
        )
      }

      return raw
    }
  }

  throw new Error(
    `No config file found. Run: node bin/capman.js init`
  )
}

export function writeManifest(manifest: Manifest, outputPath = 'manifest.json'): string {
  const resolved = path.resolve(process.cwd(), outputPath)
  fs.writeFileSync(resolved, JSON.stringify(manifest, null, 2))
  return resolved
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
  const ids = new Set<string>()

  if (!manifest.app?.trim()) errors.push('manifest.app is required')
  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
    errors.push('manifest.capabilities must be a non-empty array')
  }

  for (const cap of manifest.capabilities ?? []) {
    if (!cap.id)   errors.push(`A capability is missing an "id"`)
    if (!cap.name) errors.push(`Capability "${cap.id}" is missing a "name"`)
    if (!cap.description || cap.description.length < 10)
      errors.push(`Capability "${cap.id}" needs a longer description (min 10 chars)`)
    if (!cap.resolver) errors.push(`Capability "${cap.id}" is missing a "resolver"`)
    if (!cap.privacy)  errors.push(`Capability "${cap.id}" is missing a "privacy" scope`)

    if (ids.has(cap.id)) errors.push(`Duplicate capability id: "${cap.id}"`)
    ids.add(cap.id)

    if (!cap.examples?.length)
      warnings.push(`Capability "${cap.id}" has no examples — adding examples improves matching`)

    if (cap.resolver?.type === 'api' && !cap.resolver.endpoints?.length)
      errors.push(`Capability "${cap.id}" has an api resolver but no endpoints`)

    if (cap.resolver?.type === 'nav' && !cap.resolver.destination)
      errors.push(`Capability "${cap.id}" has a nav resolver but no destination`)
  }

  return { valid: errors.length === 0, errors, warnings }
}

export function generateStarterConfig(): string {
  return `// capman.config.js 
// Define what your app can do for AI agents.
// Replace the examples below with your own app's capabilities.

module.exports = {
  app: 'your-app-name',
  baseUrl: 'https://api.your-app.com',

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