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
        { capability: null, confidence: 0, intent: 'out_of_scope', extractedParams: {}, reasoning: 'none', candidates: [] },
        {},
        {}
      )
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('Privacy enforcement', () => {
    const authConfig: CapmanConfig = {
      app: 'test-app',
      capabilities: [
        {
          id: 'get_public_data',
          name: 'Get public data',
          description: 'Fetch publicly available data from the app.',
          examples: ['show public data'],
          params: [],
          returns: ['data'],
          resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/public' }] },
          privacy: { level: 'public' },
        },
        {
          id: 'get_private_data',
          name: 'Get private data',
          description: 'Fetch private data belonging to the authenticated user.',
          examples: ['show my private data'],
          params: [],
          returns: ['data'],
          resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/private' }] },
          privacy: { level: 'user_owned' },
        },
        {
          id: 'get_admin_data',
          name: 'Get admin data',
          description: 'Fetch sensitive admin data restricted to admin users only.',
          examples: ['show admin data'],
          params: [],
          returns: ['data'],
          resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/admin' }] },
          privacy: { level: 'admin' },
        },
      ],
    }

    const authManifest = generate(authConfig)

    it('allows public capability without auth', async () => {
      const matchResult = match('show public data', authManifest)
      const result = await resolve(matchResult, {}, { dryRun: true })
      expect(result.success).toBe(true)
    })

    it('blocks user_owned capability without auth', async () => {
      const matchResult = match('show my private data', authManifest)
      const result = await resolve(matchResult, {}, {
        dryRun: true,
        auth: { isAuthenticated: false }
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('requires authentication')
    })

    it('allows user_owned capability with auth', async () => {
      const matchResult = match('show my private data', authManifest)
      const result = await resolve(matchResult, {}, {
        dryRun: true,
        auth: { isAuthenticated: true, role: 'user', userId: 'user-123' }
      })
      expect(result.success).toBe(true)
    })

    it('blocks admin capability without admin role', async () => {
      const matchResult = match('show admin data', authManifest)
      const result = await resolve(matchResult, {}, {
        dryRun: true,
        auth: { isAuthenticated: true, role: 'user' }
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('requires admin role')
    })

    it('allows admin capability with admin role', async () => {
      const matchResult = match('show admin data', authManifest)
      const result = await resolve(matchResult, {}, {
        dryRun: true,
        auth: { isAuthenticated: true, role: 'admin' }
      })
      expect(result.success).toBe(true)
    })

    it('injects auth.userId into session params', async () => {
      const sessionConfig: CapmanConfig = {
        app: 'test-app',
        capabilities: [{
          id: 'get_my_orders',
          name: 'Get my orders',
          description: 'Fetch orders belonging to the authenticated user.',
          examples: ['show my orders'],
          params: [
            { name: 'user_id', description: 'User ID', required: true, source: 'session' }
          ],
          returns: ['orders'],
          resolver: {
            type: 'api',
            endpoints: [{ method: 'GET', path: '/users/{user_id}/orders' }],
          },
          privacy: { level: 'user_owned' },
        }],
      }
      const m = generate(sessionConfig)
      const matchResult = match('show my orders', m)
      const result = await resolve(matchResult, {}, {
        baseUrl: 'https://api.test.com',
        dryRun: true,
        auth: { isAuthenticated: true, role: 'user', userId: 'user-42' },
      })
      expect(result.success).toBe(true)
      expect(result.apiCalls?.[0].url).toBe('https://api.test.com/users/user-42/orders')
    })

    it('handles missing auth.userId gracefully', async () => {
      const sessionConfig: CapmanConfig = {
        app: 'test-app',
        capabilities: [{
          id: 'get_my_orders',
          name: 'Get my orders',
          description: 'Fetch orders belonging to the authenticated user.',
          examples: ['show my orders'],
          params: [
            { name: 'user_id', description: 'User ID', required: true, source: 'session' }
          ],
          returns: ['orders'],
          resolver: {
            type: 'api',
            endpoints: [{ method: 'GET', path: '/users/{user_id}/orders' }],
          },
          privacy: { level: 'user_owned' },
        }],
      }
      const m = generate(sessionConfig)
      const matchResult = match('show my orders', m)
      const result = await resolve(matchResult, {}, {
        baseUrl: 'https://api.test.com',
        dryRun: true,
        auth: { isAuthenticated: true, role: 'user' },
      })
      expect(result.success).toBe(true)
      expect(result.apiCalls?.[0].url).toBe('https://api.test.com/users/{user_id}/orders')
    })
  })

  describe('Fetch error handling', () => {
    it('returns failure when fetch throws a network error', async () => {
      const matchResult = match('Find resource by ID', manifest)
      const result = await resolve(
        matchResult,
        { resource_id: '42' },
        {
          baseUrl: 'https://api.test.com',
          fetch: async () => {
            throw new Error('Network error: connection refused')
          },
        }
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('Network error')
      expect(result.durationMs).toBeDefined()
    })

    it('returns failure when API returns non-ok status', async () => {
      const matchResult = match('Find resource by ID', manifest)
      const result = await resolve(
        matchResult,
        { resource_id: '42' },
        {
          baseUrl: 'https://api.test.com',
          fetch: async () => ({
            ok: false,
            status: 404,
            statusText: 'Not Found',
          } as Response),
        }
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('404')
      expect(result.durationMs).toBeDefined()
    })

    it('returns success with status and data when API returns ok', async () => {
      const matchResult = match('Find resource by ID', manifest)
      const result = await resolve(
        matchResult,
        { resource_id: '42' },
        {
          baseUrl: 'https://api.test.com',
          fetch: async () => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => JSON.stringify({ id: '42', name: 'Test Resource' }),
          } as Response),
        }
      )
      expect(result.success).toBe(true)
      expect(result.durationMs).toBeDefined()
      expect(result.apiCalls?.[0].status).toBe(200)
      expect(result.apiCalls?.[0].data).toEqual({ id: '42', name: 'Test Resource' })
    })
    
    it('retries on failure and succeeds', async () => {
      let attempts = 0
      const matchResult = match('Find resource by ID', manifest)
      const result = await resolve(
        matchResult,
        { resource_id: '42' },
        {
          baseUrl: 'https://api.test.com',
          retries: 2,
          fetch: async () => {
            attempts++
            if (attempts < 3) throw new Error('Network error')
            return { ok: true, status: 200, statusText: 'OK',
              text: async () => '{}' } as Response
          },
        }
      )
      expect(result.success).toBe(true)
      expect(attempts).toBe(3)
    })

    it('fails after exhausting retries', async () => {
      const matchResult = match('Find resource by ID', manifest)
      const result = await resolve(
        matchResult,
        { resource_id: '42' },
        {
          baseUrl: 'https://api.test.com',
          retries: 1,
          fetch: async () => { throw new Error('Network error') },
        }
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('Network error')
    })
  })

  describe('Null param handling', () => {
    it('does not write null params into API URL', async () => {
      const matchResult = match('Find resource by ID', manifest)
      const result = await resolve(
        matchResult,
        { resource_id: null },
        { baseUrl: 'https://api.test.com', dryRun: true }
      )
      expect(result.success).toBe(true)
      expect(result.apiCalls?.[0].url).not.toContain('null')
    })

    it('does not write null params into nav target', async () => {
      const matchResult = match('Take me to dashboard', manifest)
      const result = await resolve(
        matchResult,
        { destination: null },
        { dryRun: true }
      )
      expect(result.success).toBe(true)
      expect(result.navTarget).not.toContain('null')
    })

    it('URL-encodes nav param values', async () => {
      const matchResult = match('Take me to dashboard', manifest)
      const result = await resolve(
        matchResult,
        { destination: 'my-dashboard' },
        { dryRun: true }
      )
      expect(result.navTarget).toBe('/my-dashboard')
    })

    it('rejects nav param values with invalid characters', async () => {
      const matchResult = match('Take me to dashboard', manifest)
      const result = await resolve(
        matchResult,
        { destination: '../../admin' },
        { dryRun: true }
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('invalid characters')
    })

    it('rejects API path params with path traversal characters', async () => {
      const matchResult = match('Find resource by ID', manifest)
      const result = await resolve(
        matchResult,
        { resource_id: '../../admin' },
        { baseUrl: 'https://api.test.com', dryRun: true }
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('invalid characters')
    })

    it('rejects API path params with forward slash', async () => {
      const matchResult = match('Find resource by ID', manifest)
      const result = await resolve(
        matchResult,
        { resource_id: 'valid/path' },
        { baseUrl: 'https://api.test.com', dryRun: true }
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('invalid characters')
    })
  })

  describe('Session param injection', () => {
    it('does not inject empty string userId', async () => {
      const sessionConfig: CapmanConfig = {
        app: 'test-app',
        capabilities: [{
          id: 'get_my_data',
          name: 'Get my data',
          description: 'Fetch data for the current user.',
          examples: ['get my data'],
          params: [
            { name: 'user_id', description: 'User ID', required: true, source: 'session' }
          ],
          returns: ['data'],
          resolver: {
            type: 'api',
            endpoints: [{ method: 'GET', path: '/users/{user_id}/data' }],
          },
          privacy: { level: 'user_owned' },
        }],
      }
      const m = generate(sessionConfig)
      const matchResult = match('get my data', m)
      const result = await resolve(matchResult, {}, {
        baseUrl: 'https://api.test.com',
        dryRun: true,
        auth: { isAuthenticated: true, role: 'user', userId: '' },
      })
      // Empty string userId should NOT be injected — avoids /users//data
      expect(result.apiCalls?.[0].url).not.toContain('//data')
      expect(result.apiCalls?.[0].url).toBe('https://api.test.com/users/{user_id}/data')
    })
    it('does not leak session params into query string when not in path template', async () => {
      const sessionConfig: CapmanConfig = {
        app: 'test-app',
        capabilities: [{
          id: 'get_feed',
          name: 'Get feed',
          description: 'Fetch the activity feed for the current user.',
          examples: ['get my feed'],
          params: [
            { name: 'user_id', description: 'User ID', required: true, source: 'session' }
          ],
          returns: ['feed'],
          resolver: {
            type: 'api',
            // path has no {user_id} template — session param must NOT leak to QS
            endpoints: [{ method: 'GET', path: '/feed' }],
          },
          privacy: { level: 'user_owned' },
        }],
      }
      const m = generate(sessionConfig)
      const matchResult = match('get my feed', m)
      const result = await resolve(matchResult, {}, {
        baseUrl: 'https://api.test.com',
        dryRun: true,
        auth: { isAuthenticated: true, role: 'user', userId: 'abc123' },
      })
      expect(result.apiCalls?.[0].url).toBe('https://api.test.com/feed')
      expect(result.apiCalls?.[0].url).not.toContain('user_id')
      expect(result.apiCalls?.[0].url).not.toContain('abc123')
    })
    it('does not inject session param for endpoints that lack the placeholder', async () => {
      const multiEndpointConfig: CapmanConfig = {
        app: 'test-app',
        capabilities: [{
          id: 'multi_endpoint',
          name: 'Multi endpoint',
          description: 'Capability with multiple endpoints only one having user_id.',
          examples: ['do multi endpoint thing'],
          params: [
            { name: 'user_id', description: 'User ID', required: true, source: 'session' }
          ],
          returns: ['result'],
          resolver: {
            type: 'api',
            endpoints: [
              { method: 'GET', path: '/users/{user_id}/data' },  // has placeholder
              { method: 'POST', path: '/audit/log' },             // no placeholder
            ],
          },
          privacy: { level: 'user_owned' },
        }],
      }
      const m = generate(multiEndpointConfig)
      const matchResult = match('do multi endpoint thing', m)
      const result = await resolve(matchResult, {}, {
        baseUrl: 'https://api.test.com',
        dryRun: true,
        auth: { isAuthenticated: true, role: 'user', userId: 'abc123' },
      })
      const urls = result.apiCalls?.map(c => c.url) ?? []
      // First endpoint — user_id correctly substituted
      expect(urls[0]).toBe('https://api.test.com/users/abc123/data')
      // Second endpoint — user_id must NOT appear in URL or query string
      expect(urls[1]).toBe('https://api.test.com/audit/log')
      expect(urls[1]).not.toContain('user_id')
      expect(urls[1]).not.toContain('abc123')
    })
  })
  

})