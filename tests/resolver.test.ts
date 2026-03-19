import { describe, it, expect } from 'vitest'
import { generate, match, resolve } from '../src/index'
import type { CapmanConfig } from '../src/types'

const config: CapmanConfig = {
  app: 'test-app',
  capabilities: [
    {
      id: 'get_resource',
      name: 'Get resource',
      description: 'Fetch a specific resource by ID from the app.',
      examples: ['Find resource by ID', 'Get resource 42'],
      params: [
        { name: 'resource_id', description: 'Resource ID', required: true, source: 'user_query' }
      ],
      returns: ['resource'],
      resolver: {
        type: 'api',
        endpoints: [{ method: 'GET', path: '/resources/{resource_id}' }],
      },
      privacy: { level: 'public' },
    },
    {
      id: 'navigate_to_screen',
      name: 'Navigate to screen',
      description: 'Route the user to a specific page in the app.',
      examples: ['Take me to dashboard', 'Open settings'],
      params: [
        { name: 'destination', description: 'Target screen', required: true, source: 'user_query' }
      ],
      returns: ['deep_link'],
      resolver: { type: 'nav', destination: '/{destination}' },
      privacy: { level: 'public' },
    },
    {
      id: 'get_user_with_nav',
      name: 'Get user and navigate',
      description: 'Fetch user data and navigate to their profile page.',
      examples: ['Show johndoe profile page'],
      params: [
        { name: 'username', description: 'Username', required: true, source: 'user_query' }
      ],
      returns: ['user', 'deep_link'],
      resolver: {
        type: 'hybrid',
        api: { endpoints: [{ method: 'GET', path: '/users/{username}' }] },
        nav: { destination: '/profile/{username}' },
      },
      privacy: { level: 'public' },
    },
  ],
}

const manifest = generate(config)

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('resolve()', () => {

  describe('API resolver', () => {
    it('returns correct api call in dry run', async () => {
      const matchResult = match('Find resource by ID', manifest)
      const result = await resolve(
        matchResult,
        { resource_id: '42' },
        { baseUrl: 'https://api.test.com', dryRun: true }
      )
      expect(result.success).toBe(true)
      expect(result.resolverType).toBe('api')
      expect(result.apiCalls).toHaveLength(1)
      expect(result.apiCalls?.[0].url).toBe('https://api.test.com/resources/42')
      expect(result.apiCalls?.[0].method).toBe('GET')
    })

    it('substitutes path params correctly', async () => {
      const matchResult = match('Find resource by ID', manifest)
      const result = await resolve(
        matchResult,
        { resource_id: 'abc-123' },
        { baseUrl: 'https://api.test.com', dryRun: true }
      )
      expect(result.apiCalls?.[0].url).toBe('https://api.test.com/resources/abc-123')
    })

    it('appends unused params as query string', async () => {
      const matchResult = match('Find resource by ID', manifest)
      const result = await resolve(
        matchResult,
        { resource_id: '42', filter: 'active' },
        { baseUrl: 'https://api.test.com', dryRun: true }
      )
      expect(result.apiCalls?.[0].url).toContain('filter=active')
    })
  })

  describe('Nav resolver', () => {
    it('returns correct nav target', async () => {
      const matchResult = match('Take me to dashboard', manifest)
      const result = await resolve(
        matchResult,
        { destination: 'dashboard' },
        { dryRun: true }
      )
      expect(result.success).toBe(true)
      expect(result.resolverType).toBe('nav')
      expect(result.navTarget).toBe('/dashboard')
    })
  })

  describe('Hybrid resolver', () => {
    it('returns both api calls and nav target', async () => {
      const matchResult = match('Show johndoe profile page', manifest)
      const result = await resolve(
        matchResult,
        { username: 'johndoe' },
        { baseUrl: 'https://api.test.com', dryRun: true }
      )
      expect(result.success).toBe(true)
      expect(result.resolverType).toBe('hybrid')
      expect(result.apiCalls).toHaveLength(1)
      expect(result.apiCalls?.[0].url).toBe('https://api.test.com/users/johndoe')
      expect(result.navTarget).toBe('/profile/johndoe')
    })
  })

  describe('No match', () => {
    it('returns failure when no capability matched', async () => {
      const result = await resolve(
        { capability: null, confidence: 0, intent: 'out_of_scope', extractedParams: {}, reasoning: 'none' },
        {},
        {}
      )
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

})