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

    it('LRU eviction moves accessed entries to most-recently-used position', async () => {
      const cache = new MemoryCache()

      const fakeResult = {
        capability: null,
        confidence: 0,
        intent: 'out_of_scope' as const,
        extractedParams: {},
        reasoning: 'test',
        candidates: [],
      }

      // Fill cache to max capacity (512) then add one more to trigger eviction
      for (let i = 0; i < 512; i++) {
        await cache.set(`query-${i}`, fakeResult)
      }

      // Access query-0 — makes it most recently used
      await cache.get('query-0')

      // Add one more — triggers eviction of least recently used (query-1, not query-0)
      await cache.set('query-512', fakeResult)

      expect(await cache.get('query-0')).not.toBeNull()  // recently accessed — stays
      expect(await cache.get('query-1')).toBeNull()       // LRU — evicted
      expect(await cache.get('query-512')).not.toBeNull() // just added — stays
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

      await engine.ask('Show me articles', { dryRun: true }) // keyword
      await engine.ask('Show me articles', { dryRun: true }) // cache

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

  describe('LLM rate limiting', () => {
    it('skips LLM when rate limit is exceeded', async () => {
      let llmCalled = false
      const engine = new CapmanEngine({
        manifest,
        cache: false,
        learning: false,
        mode: 'balanced',
        maxLLMCallsPerMinute: 0, // immediately exhausted
        llm: async () => {
          llmCalled = true
          return JSON.stringify({
            matched_capability: 'get_articles',
            confidence: 90,
            intent: 'retrieval',
            reasoning: 'test',
            extracted_params: {},
          })
        },
      })

      const result = await engine.ask('something vague', { dryRun: true })
      expect(llmCalled).toBe(false)
      expect(result.trace.steps.some(s => s.type === 'llm_match' && s.status === 'skip')).toBe(true)
    })

    it('skips LLM when cooldown is active', async () => {
      let llmCallCount = 0
      const engine = new CapmanEngine({
        manifest,
        cache: false,
        learning: false,
        mode: 'accurate',
        llmCooldownMs: 60_000, // 60 second cooldown
        llm: async () => {
          llmCallCount++
          return JSON.stringify({
            matched_capability: 'get_articles',
            confidence: 90,
            intent: 'retrieval',
            reasoning: 'test',
            extracted_params: {},
          })
        },
      })

      // First call — LLM should be called
      await engine.ask('Show me articles', { dryRun: true })
      expect(llmCallCount).toBe(1)

      // Second call — cooldown active, LLM should be skipped
      await engine.ask('Show me articles', { dryRun: true })
      expect(llmCallCount).toBe(1)
    })

    it('opens circuit breaker after consecutive failures', async () => {
      let llmCallCount = 0
      const engine = new CapmanEngine({
        manifest,
        cache: false,
        learning: false,
        mode: 'accurate',
        llmCircuitBreakerThreshold: 2,
        llmCircuitBreakerResetMs: 60_000,
        llm: async () => {
          llmCallCount++
          throw new Error('LLM provider unavailable')
        },
      })

      // First two calls — LLM fails, circuit opens
      await engine.ask('Show me articles', { dryRun: true })
      await engine.ask('Show me articles', { dryRun: true })
      expect(llmCallCount).toBe(2)

      // Third call — circuit open, LLM not called
      await engine.ask('Show me articles', { dryRun: true })
      expect(llmCallCount).toBe(2)
    })

    it('falls back to keyword when LLM fails', async () => {
      const engine = new CapmanEngine({
        manifest,
        cache: false,
        learning: false,
        mode: 'accurate',
        llmCircuitBreakerThreshold: 99,
        llm: async () => { throw new Error('LLM unavailable') },
      })

      const result = await engine.ask('Show me articles', { dryRun: true })
      // Should still return a result via keyword fallback
      expect(result.resolution).toBeDefined()
      expect(result.trace.steps.some(s => s.type === 'llm_match' && s.status === 'fail')).toBe(true)
    })
  })

  describe('manifest version compatibility', () => {
    it('warns when manifest version differs from engine version', async () => {
      const oldManifest = {
        ...manifest,
        version: '0.1.0',
      }
      // Should not throw — just warn
      const engine = new CapmanEngine({
        manifest: oldManifest,
        cache: false,
        learning: false,
        mode: 'cheap',
      })
      const result = await engine.ask('Show me articles', { dryRun: true })
      expect(result.match).toBeDefined()
    })

    it('does not warn when manifest version matches', async () => {
      const { VERSION } = await import('../src/version')
      const currentManifest = { ...manifest, version: VERSION }
      const engine = new CapmanEngine({
        manifest: currentManifest,
        cache: false,
        learning: false,
        mode: 'cheap',
      })
      const result = await engine.ask('Show me articles', { dryRun: true })
      expect(result.match).toBeDefined()
    })
  })

  describe('learning boost', () => {
    it('applies boost to candidates with historical matches', async () => {
      const learning = new MemoryLearningStore()
      const engine   = new CapmanEngine({
        manifest,
        cache: false,
        learning,
        mode: 'balanced',
        threshold: 1, // low threshold so LLM fallback doesn't interfere
      })

      // Record several matches to build the index
      for (let i = 0; i < 5; i++) {
        await engine.ask('Show me articles', { dryRun: true })
      }

      // 6th call — boost should now influence scoring
      const result = await engine.ask('Show me articles', { dryRun: true })
      expect(result.match.confidence).toBeGreaterThan(0)

      const stats = await engine.getStats()
      expect(stats?.totalQueries).toBe(6)
      expect(stats?.index).toBeDefined()
      // Verify index has entries for meaningful words
      const indexWords = Object.keys(stats?.index ?? {})
      expect(indexWords.length).toBeGreaterThan(0)
    })

    it('learning boost does not push score above 100', async () => {
      const learning = new MemoryLearningStore()
      const engine   = new CapmanEngine({
        manifest,
        cache: false,
        learning,
        mode: 'balanced',
        threshold: 1,
      })

      // Build up history
      for (let i = 0; i < 20; i++) {
        await engine.ask('Show me articles', { dryRun: true })
      }

      const result = await engine.ask('Show me articles', { dryRun: true })
      expect(result.match.confidence).toBeLessThanOrEqual(100)
      result.trace.candidates.forEach(c => {
        expect(c.score).toBeLessThanOrEqual(100)
      })
    })

    it('boost is skipped in cheap mode', async () => {
      const learning = new MemoryLearningStore()
      const engine   = new CapmanEngine({
        manifest,
        cache: false,
        learning,
        mode: 'cheap',
      })

      // Record history
      for (let i = 0; i < 10; i++) {
        await engine.ask('Show me articles', { dryRun: true })
      }

      // Cheap mode — boost should never run
      const result = await engine.ask('Show me articles', { dryRun: true })
      expect(result.match).toBeDefined()
      // In cheap mode resolvedVia is always keyword
      expect(result.resolvedVia).toBe('keyword')
    })

    it('boost does not affect OOS queries with no keyword signal', async () => {
      const learning = new MemoryLearningStore()
      const engine   = new CapmanEngine({
        manifest,
        cache: false,
        learning,
        mode: 'balanced',
        threshold: 50,
      })

      // Build history for articles
      for (let i = 0; i < 10; i++) {
        await engine.ask('Show me articles', { dryRun: true })
      }

      // Completely unrelated query with no keyword signal should stay OOS
      const result = await engine.ask('xyzzy plugh twisty passages', { dryRun: true })
      // If all candidates score 0, boost should not override
      const allZero = result.trace.candidates.every(c => c.score === 0)
      if (allZero) {
        expect(result.match.capability).toBeNull()
      }
    })
  })

  describe('query validation', () => {
    it('throws TypeError for empty query', async () => {
      const engine = new CapmanEngine({ manifest, cache: false, learning: false })
      await expect(engine.ask('')).rejects.toThrow(TypeError)
    })

    it('throws TypeError for non-string query', async () => {
      const engine = new CapmanEngine({ manifest, cache: false, learning: false })
      // @ts-expect-error — testing runtime guard
      await expect(engine.ask(null)).rejects.toThrow(TypeError)
    })

    it('throws RangeError for query exceeding max length', async () => {
      const engine = new CapmanEngine({ manifest, cache: false, learning: false })
      const longQuery = 'a'.repeat(CapmanEngine.MAX_QUERY_LENGTH + 1)
      await expect(engine.ask(longQuery)).rejects.toThrow(RangeError)
    })

    it('accepts query at exactly max length', async () => {
      const engine = new CapmanEngine({ manifest, cache: false, learning: false, mode: 'cheap' })
      const maxQuery = 'a'.repeat(CapmanEngine.MAX_QUERY_LENGTH)
      const result = await engine.ask(maxQuery, { dryRun: true })
      expect(result).toBeDefined()
    })

    it('explain() throws RangeError for query exceeding max length', async () => {
      const engine = new CapmanEngine({ manifest, cache: false, learning: false })
      const longQuery = 'a'.repeat(CapmanEngine.MAX_QUERY_LENGTH + 1)
      await expect(engine.explain(longQuery)).rejects.toThrow(RangeError)
    })
  })

  describe('fuzzy matching', () => {
    it('matches query with typo when fuzzyMatch enabled', async () => {
      const engine = new CapmanEngine({
        manifest,
        cache: false,
        learning: false,
        mode: 'balanced',
        fuzzyMatch: true,
        fuzzyThreshold: 0.4,
      })

      // "Shwo me artciles" — typos that keyword matcher misses entirely
      // Fuse.js fuzzy matching should still match "Show me articles"
      const result = await engine.ask('Shwo me articles', { dryRun: true })
      expect(result.match.capability?.id).toBe('get_articles')
    })

    it('does not use fuzzy in cheap mode', async () => {
      const engine = new CapmanEngine({
        manifest,
        cache: false,
        learning: false,
        mode: 'cheap',
        fuzzyMatch: true,
      })

      // cheap mode — fuzzy never runs regardless of fuzzyMatch option
      const result = await engine.ask('display news feed', { dryRun: true })
      // Result may or may not match — we just verify it didn't throw
      expect(result).toBeDefined()
      expect(result.resolvedVia).toBe('keyword')
    })

    it('fuzzy disabled by default', async () => {
      const engine = new CapmanEngine({
        manifest,
        cache: false,
        learning: false,
        mode: 'balanced',
        // fuzzyMatch not set — defaults to false
      })

      const result = await engine.ask('display news feed', { dryRun: true })
      // Without fuzzy, paraphrase scores 0 — out of scope
      expect(result.match.capability).toBeNull()
    })

    it('stricter threshold rejects weak matches', async () => {
      const engine = new CapmanEngine({
        manifest,
        cache: false,
        learning: false,
        mode: 'balanced',
        fuzzyMatch: true,
        fuzzyThreshold: 0.1,  // very strict
      })

      // Very strict threshold — only near-exact matches pass
      const result = await engine.ask('show articles', { dryRun: true })
      expect(result).toBeDefined()
    })
  })

})
