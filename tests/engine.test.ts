import { describe, it, expect, beforeEach } from 'vitest'
import { generate } from '../src/index'
import { CapmanEngine } from '../src/engine'
import { MemoryCache } from '../src/cache'
import { MemoryLearningStore } from '../src/learning'
import type { CapmanConfig } from '../src/types'

const config: CapmanConfig = {
  app: 'test-app',
  capabilities: [
    {
      id: 'get_articles',
      name: 'Get articles',
      description: 'Fetch a list of articles from the platform.',
      examples: ['Show me articles', 'List all posts', 'Get latest articles'],
      params: [],
      returns: ['articles'],
      resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/articles' }] },
      privacy: { level: 'public' },
    },
    {
      id: 'get_user_profile',
      name: 'Get user profile',
      description: 'Fetch the public profile of a user by username.',
      examples: ['Show profile for johndoe', 'Get user jane'],
      params: [
        { name: 'username', description: 'Username to look up', required: true, source: 'user_query' }
      ],
      returns: ['profile'],
      resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/profiles/{username}' }] },
      privacy: { level: 'public' },
    },
  ],
}

const manifest = generate(config)

describe('CapmanEngine', () => {

  describe('basic ask()', () => {
    it('matches and resolves a clear query', async () => {
      const engine = new CapmanEngine({
        manifest,
        cache: false,
        learning: false,
        baseUrl: 'https://api.test.com',
        mode: 'cheap',
      })

      const result = await engine.ask('Show me articles', { dryRun: true })
      expect(result.match.capability?.id).toBe('get_articles')
      expect(result.resolution.success).toBe(true)
      expect(result.resolvedVia).toBe('keyword')
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('returns out of scope for irrelevant query', async () => {
      const engine = new CapmanEngine({
        manifest,
        cache: false,
        learning: false,
        mode: 'cheap',
      })

      const result = await engine.ask('Is the server down?')
      expect(result.match.capability).toBeNull()
      expect(result.match.intent).toBe('out_of_scope')
    })
  })

  describe('caching', () => {
    it('serves second query from cache', async () => {
      const cache = new MemoryCache()
      const engine = new CapmanEngine({
        manifest,
        cache,
        learning: false,
        mode: 'cheap',
      })

      const r1 = await engine.ask('Show me articles', { dryRun: true })
      expect(r1.resolvedVia).toBe('keyword')

      const r2 = await engine.ask('Show me articles', { dryRun: true })
      expect(r2.resolvedVia).toBe('cache')
      expect(r2.match.capability?.id).toBe(r1.match.capability?.id)
    })

    it('cache can be cleared', async () => {
      const cache = new MemoryCache()
      const engine = new CapmanEngine({
        manifest,
        cache,
        learning: false,
        mode: 'cheap',
      })

      await engine.ask('Show me articles', { dryRun: true })
      expect(await cache.size()).toBeGreaterThanOrEqual(1)

      await engine.clearCache()
      expect(await cache.size()).toBe(0)
    })

    it('ComboCache promotes file hit to memory', async () => {
      const { ComboCache } = await import('../src/cache')
      const combo = new ComboCache()

      // Manually set in file cache
      await combo['file'].set('Show me articles', {
        capability: manifest.capabilities[0],
        confidence: 100,
        intent: 'retrieval' as const,
        extractedParams: {},
        reasoning: 'test',
      })

      // First get — comes from file, promotes to memory
      const hit1 = await combo.get('Show me articles')
      expect(hit1).not.toBeNull()
      expect(hit1?.result.capability?.id).toBe('get_articles')

      // Second get — comes from memory (promoted)
      const memHit = await combo['memory'].get('Show me articles')
      expect(memHit).not.toBeNull()
    })
  })

  describe('learning', () => {
    it('records queries to learning store', async () => {
      const learning = new MemoryLearningStore()
      const engine = new CapmanEngine({
        manifest,
        cache: false,
        learning,
        mode: 'cheap',
      })

      await engine.ask('Show me articles')
      await engine.ask('Get user jane')
      await engine.ask('Is the server down?')

      const stats = await engine.getStats()
      expect(stats?.totalQueries).toBe(3)
      expect(stats?.outOfScope).toBe(1)
    })

    it('getTopCapabilities returns most used', async () => {
      const learning = new MemoryLearningStore()
      const engine = new CapmanEngine({
        manifest,
        cache: false,
        learning,
        mode: 'cheap',
      })

      await engine.ask('Show me articles')
      await engine.ask('List all posts')
      await engine.ask('Get user jane')

      const top = await engine.getTopCapabilities(2)
      expect(top[0].id).toBe('get_articles')
      expect(top[0].hits).toBe(2)
    })

    it('records resolvedVia correctly', async () => {
      const cache    = new MemoryCache()
      const learning = new MemoryLearningStore()
      const engine   = new CapmanEngine({
        manifest,
        cache,
        learning,
        mode: 'cheap',
      })

      await engine.ask('Show me articles') // keyword
      await engine.ask('Show me articles') // cache

      const stats = await engine.getStats()
      expect(stats?.cacheHits).toBe(1)
    })
  })

  describe('modes', () => {
    it('cheap mode never uses LLM', async () => {
      let llmCalled = false
      const engine = new CapmanEngine({
        manifest,
        cache: false,
        learning: false,
        mode: 'cheap',
        llm: async () => { llmCalled = true; return '{}' },
      })

      await engine.ask('Show me articles')
      expect(llmCalled).toBe(false)
    })

    it('accurate mode uses LLM when provided', async () => {
      let llmCalled = false
      const engine = new CapmanEngine({
        manifest,
        cache: false,
        learning: false,
        mode: 'accurate',
        llm: async () => {
          llmCalled = true
          return JSON.stringify({
            matched_capability: 'get_articles',
            confidence: 90,
            intent: 'retrieval',
            reasoning: 'User wants articles',
            extracted_params: {},
          })
        },
      })

      await engine.ask('Show me articles')
      expect(llmCalled).toBe(true)
    })
  })

  describe('execution trace', () => {
    it('trace contains candidates with scores', async () => {
      const engine = new CapmanEngine({
        manifest,
        cache: false,
        learning: false,
        mode: 'cheap',
      })

      const result = await engine.ask('Show me articles', { dryRun: true })
      expect(result.trace).toBeDefined()
      expect(result.trace.candidates.length).toBeGreaterThan(0)
      expect(result.trace.candidates.some(c => c.matched)).toBe(true)
    })

    it('trace contains reasoning array', async () => {
      const engine = new CapmanEngine({
        manifest,
        cache: false,
        learning: false,
        mode: 'cheap',
      })

      const result = await engine.ask('Show me articles', { dryRun: true })
      expect(result.trace.reasoning.length).toBeGreaterThan(0)
      expect(result.trace.reasoning[0]).toContain('get_articles')
    })

    it('trace contains steps', async () => {
      const engine = new CapmanEngine({
        manifest,
        cache: false,
        learning: false,
        mode: 'cheap',
      })

      const result = await engine.ask('Show me articles', { dryRun: true })
      expect(result.trace.steps.length).toBeGreaterThan(0)
      expect(result.trace.steps.some(s => s.type === 'keyword_match')).toBe(true)
    })

    it('trace shows cache hit when served from cache', async () => {
      const cache = new MemoryCache()
      const engine = new CapmanEngine({
        manifest,
        cache,
        learning: false,
        mode: 'cheap',
      })

      await engine.ask('Show me articles', { dryRun: true })
      const r2 = await engine.ask('Show me articles', { dryRun: true })
      expect(r2.trace.resolvedVia).toBe('cache')
      expect(r2.trace.steps.some(s => s.type === 'cache_check' && s.status === 'hit')).toBe(true)
    })

    it('trace totalMs is a positive number', async () => {
      const engine = new CapmanEngine({
        manifest,
        cache: false,
        learning: false,
        mode: 'cheap',
      })

      const result = await engine.ask('Show me articles', { dryRun: true })
      expect(result.trace.totalMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe('explain()', () => {
    it('returns matched capability for clear query', async () => {
      const engine = new CapmanEngine({
        manifest,
        cache: false,
        learning: false,
        mode: 'cheap',
      })

      const result = await engine.explain('Show me articles')
      expect(result.matched.capability?.id).toBe('get_articles')
      expect(result.matched.confidence).toBeGreaterThanOrEqual(50)
      expect(result.matched.reasoning.length).toBeGreaterThan(0)
    })

    it('returns out of scope for irrelevant query', async () => {
      const engine = new CapmanEngine({
        manifest,
        cache: false,
        learning: false,
        mode: 'cheap',
      })

      const result = await engine.explain('Is the server down?')
      expect(result.matched.capability).toBeNull()
      expect(result.matched.intent).toBe('out_of_scope')
    })

    it('returns all candidates with explanations', async () => {
      const engine = new CapmanEngine({
        manifest,
        cache: false,
        learning: false,
        mode: 'cheap',
      })

      const result = await engine.explain('Show me articles')
      expect(result.candidates.length).toBe(manifest.capabilities.length)
      result.candidates.forEach(c => {
        expect(c.explanation.length).toBeGreaterThan(0)
        expect(typeof c.score).toBe('number')
      })
    })

    it('shows would execute action for api resolver', async () => {
      const engine = new CapmanEngine({
        manifest,
        cache: false,
        learning: false,
        mode: 'cheap',
        baseUrl: 'https://api.test.com',
      })

      const result = await engine.explain('Show me articles')
      expect(result.wouldExecute.action).toContain('GET')
      expect(result.wouldExecute.action).toContain('https://api.test.com')
      expect(result.wouldExecute.blocked).toBeNull()
    })

    it('shows blocked when privacy would prevent execution', async () => {
      const privateConfig: CapmanConfig = {
        app: 'test-app',
        capabilities: [{
          id: 'get_private_data',
          name: 'Get private data',
          description: 'Fetch private data for authenticated user.',
          examples: ['show my private data', 'get my data'],
          params: [],
          returns: ['data'],
          resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/private' }] },
          privacy: { level: 'user_owned' },
        }],
      }
      const privateManifest = generate(privateConfig)
      const engine = new CapmanEngine({
        manifest: privateManifest,
        cache: false,
        learning: false,
        mode: 'cheap',
        // no auth provided
      })

      const result = await engine.explain('show my private data')
      expect(result.wouldExecute.blocked).toContain('authentication')
    })

    it('does not affect cache or learning', async () => {
      const cache    = new MemoryCache()
      const learning = new MemoryLearningStore()
      const engine   = new CapmanEngine({
        manifest,
        cache,
        learning,
        mode: 'cheap',
      })

      await engine.explain('Show me articles')
      expect(await cache.size()).toBe(0)
      const stats = await engine.getStats()
      expect(stats?.totalQueries).toBe(0)
    })

    it('returns durationMs', async () => {
      const engine = new CapmanEngine({
        manifest,
        cache: false,
        learning: false,
        mode: 'cheap',
      })

      const result = await engine.explain('Show me articles')
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })
  })

})
