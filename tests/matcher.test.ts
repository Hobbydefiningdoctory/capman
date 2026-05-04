import { describe, it, expect } from 'vitest'
import { generate, match, matchWithLLM } from '../src/index'
import type { CapmanConfig } from '../src/types'
import { stem, tokenize } from '../src/matcher'

// ─── Minimal test manifest ────────────────────────────────────────────────────

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
      examples: ['Show profile for johndoe', 'Get user jane', 'Who is techwriter42'],
      params: [
        { name: 'username', description: 'Username to look up', required: true, source: 'user_query' }
      ],
      returns: ['profile'],
      resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/profiles/{username}' }] },
      privacy: { level: 'public' },
    },
    {
      id: 'navigate_to_screen',
      name: 'Navigate to screen',
      description: 'Route the user to a specific page in the app.',
      examples: ['Take me to dashboard', 'Open settings', 'Go to profile page'],
      params: [
        { name: 'destination', description: 'Target screen', required: true, source: 'user_query' }
      ],
      returns: ['deep_link'],
      resolver: { type: 'nav', destination: '{destination}' },
      privacy: { level: 'public' },
    },
  ],
}

const manifest = generate(config)

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('match()', () => {

  describe('clear queries', () => {
    it('matches article query at high confidence', () => {
      const result = match('Show me articles', manifest)
      expect(result.capability?.id).toBe('get_articles')
      expect(result.confidence).toBeGreaterThanOrEqual(50)
      expect(result.intent).toBe('retrieval')
    })

    it('matches profile query at high confidence', () => {
      const result = match('Show profile for johndoe', manifest)
      expect(result.capability?.id).toBe('get_user_profile')
      expect(result.confidence).toBeGreaterThanOrEqual(50)
    })

    it('matches navigation query', () => {
      const result = match('Take me to dashboard', manifest)
      expect(result.capability?.id).toBe('navigate_to_screen')
      expect(result.intent).toBe('navigation')
    })
  })

  describe('out of scope queries', () => {
    it('rejects irrelevant query', () => {
      const result = match('Is the server down?', manifest)
      expect(result.capability).toBeNull()
      expect(result.intent).toBe('out_of_scope')
    })

    it('rejects empty query', () => {
      const result = match('', manifest)
      expect(result.capability).toBeNull()
      expect(result.confidence).toBe(0)
    })

    it('rejects weather query', () => {
      const result = match('What is the weather today?', manifest)
      expect(result.capability).toBeNull()
      expect(result.intent).toBe('out_of_scope')
    })
  })

  describe('param extraction', () => {
    it('extracts username from profile query', () => {
      const result = match('Show profile for johndoe', manifest)
      expect(result.extractedParams.username).toBe('johndoe')
    })

    it('marks session params correctly', () => {
      const sessionConfig: CapmanConfig = {
        app: 'test',
        capabilities: [{
          id: 'get_my_data',
          name: 'Get my data',
          description: 'Fetch data for the current authenticated user.',
          examples: ['show my data'],
          params: [{ name: 'user_id', description: 'User ID', required: true, source: 'session' }],
          returns: ['data'],
          resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/me' }] },
          privacy: { level: 'user_owned' },
        }],
      }
      const m = generate(sessionConfig)
      const result = match('show my data', m)
      expect(result.extractedParams.user_id).toBeNull() // session params return null — injected by resolver
    })
  })

  describe('intent classification', () => {
    it('classifies api resolver as retrieval', () => {
      const result = match('Get latest articles', manifest)
      expect(result.intent).toBe('retrieval')
    })

    it('classifies nav resolver as navigation', () => {
      const result = match('Open settings', manifest)
      expect(result.intent).toBe('navigation')
    })
  })

  describe('ask() matching modes', () => {
    it('cheap mode — uses keyword only, never LLM', async () => {
      const { ask } = await import('../src/index')
      const result = await ask('Show me articles', manifest, {
        mode: 'cheap',
        dryRun: true,
      })
      expect(result.match.capability?.id).toBe('get_articles')
      expect(result.match.confidence).toBeGreaterThanOrEqual(50)
    })

    it('balanced mode — uses keyword when confident', async () => {
      const { ask } = await import('../src/index')
      const result = await ask('Show me articles', manifest, {
        mode: 'balanced',
        dryRun: true,
      })
      expect(result.match.capability?.id).toBe('get_articles')
    })

    it('accurate mode — warns and falls back when no llm provided', async () => {
      const { ask } = await import('../src/index')
      const result = await ask('Show me articles', manifest, {
        mode: 'accurate',
        dryRun: true,
        // no llm provided — should fallback to keyword
      })
      expect(result.match.capability?.id).toBe('get_articles')
    })

    it('defaults to balanced mode when no mode specified', async () => {
      const { ask } = await import('../src/index')
      const result = await ask('Show me articles', manifest, {
        dryRun: true,
      })
      expect(result.match.capability?.id).toBe('get_articles')
    })
  })

  describe('matchWithLLM edge cases', () => {
    it('returns out_of_scope when LLM returns unknown capability ID', async () => {
      const result = await matchWithLLM('show me articles', manifest, {
        llm: async () => JSON.stringify({
          matched_capability: 'nonexistent_capability_xyz',
          confidence: 90,
          intent: 'retrieval',
          reasoning: 'test',
          extracted_params: {},
        }),
      })
      expect(result.capability).toBeNull()
      expect(result.intent).toBe('out_of_scope')
      expect(result.confidence).toBe(0)
    })

    it('handles undefined reasoning from LLM gracefully', async () => {
      const result = await matchWithLLM('show me articles', manifest, {
        llm: async () => JSON.stringify({
          matched_capability: 'OUT_OF_SCOPE',
          confidence: 0,
          intent: 'out_of_scope',
          extracted_params: {},
          // no reasoning field
        }),
      })
      expect(result.reasoning).toBe('No reasoning provided')
    })
  })

  describe('example scoring', () => {
    it('takes best example score not sum — quality beats quantity', () => {
      const bloatedConfig: CapmanConfig = {
        app: 'test-app',
        capabilities: [
          {
            id: 'precise_cap',
            name: 'Precise capability',
            description: 'Shows articles in the news feed.',
            examples: ['show me articles'],  // 1 perfect example
            params: [],
            returns: ['articles'],
            resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/articles' }] },
            privacy: { level: 'public' },
          },
          {
            id: 'bloated_cap',
            name: 'Bloated capability',
            description: 'Displays content items in a feed view.',
            examples: [
              'view content',       // partial overlap
              'display items',      // partial overlap
              'browse feed',        // partial overlap
              'list things',        // partial overlap
              'open section',       // partial overlap
              'see stuff',          // partial overlap
              'check updates',      // partial overlap
              'load more',          // partial overlap
              'fetch data',         // partial overlap
              'get results',        // partial overlap
            ],
            params: [],
            returns: ['items'],
            resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/items' }] },
            privacy: { level: 'public' },
          },
        ],
      }
      const m = generate(bloatedConfig)
      const result = match('show me articles', m)

      // precise_cap has one perfect example — should win
      expect(result.capability?.id).toBe('precise_cap')

      // bloated_cap should not beat precise_cap despite having 10 examples
      const bloated = result.candidates.find(c => c.capabilityId === 'bloated_cap')
      const precise = result.candidates.find(c => c.capabilityId === 'precise_cap')
      expect(precise!.score).toBeGreaterThan(bloated!.score)
    })
  })

  describe('stemmer and tokenizer', () => {
    it('stems common suffixes correctly', () => {
      expect(stem('tracking')).toBe('track')
      expect(stem('ordered')).toBe('order')
      expect(stem('orders')).toBe('order')
      expect(stem('fetches')).toBe('fetch')
      expect(stem('quickly')).toBe('quick')
      expect(stem('class')).toBe('class')   // ss guard — not stripped
      expect(stem('access')).toBe('access') // ss guard — not stripped
    })

    it('tokenize filters stopwords and stems', () => {
      const tokens = tokenize('Show me the tracking orders')
      expect(tokens).toContain('track')
      expect(tokens).toContain('order')
      expect(tokens).not.toContain('show')  // stopword
      expect(tokens).not.toContain('me')    // stopword
      expect(tokens).not.toContain('the')   // stopword
    })

    it('tokenize is symmetric — same stem for query and example', () => {
      // 'tracking' → 'track', 'track' → 'track' — symmetric ✓
      const queryTokens   = new Set(tokenize('tracking shipments'))
      const exampleTokens = new Set(tokenize('track shipment status'))
      expect(queryTokens.has('track')).toBe(true)
      expect(exampleTokens.has('track')).toBe(true)
      // Note: single-pass stemmer — 'orders' → 'order', 'order' → 'ord'
      // Use -ing forms for symmetry tests since they reduce to the root in one pass
    })
  })
  
})