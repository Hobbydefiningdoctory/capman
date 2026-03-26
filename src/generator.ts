import { VERSION } from './version'
import * as fs from 'fs'
import * as path from 'path'
import type { CapmanConfig, Manifest, ValidationResult } from './types'
import { validateConfig, validateManifest } from './schema'
import { logger } from './logger'

export function generate(config: CapmanConfig): Manifest {
  return {
    version: VERSION,
    app: config.app,
    generatedAt: new Date().toISOString(),
    capabilities: config.capabilities.map(cap => ({ ...cap, params: [...cap.params] })),
  }
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
      try {
        const mod = require(resolved)
        raw = mod.default ?? mod
      } catch (err) {
        throw new Error(
          `Failed to load config at ${resolved}:\n` +
          `  ${err instanceof Error ? err.message : String(err)}\n\n` +
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