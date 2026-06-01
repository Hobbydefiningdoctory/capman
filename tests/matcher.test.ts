import { describe, it, expect } from 'vitest'
import { generate, match, matchWithLLM } from '../src/index'
import type { CapmanConfig } from '../src/types'
import { stem, tokenize } from '../src/matcher'
import { filterByTags, extractParams} from '../src/matcher'

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
      const result = await matchWithLLM('show me articles', manifest.capabilities, {
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
      const result = await matchWithLLM('show me articles', manifest.capabilities, {
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

    it('tokenize splits camelCase before lowercasing (Bug 2)', () => {
      // "PaymentIntent" must become two tokens — "payment" and "intent" —
      // not one opaque "paymentintent" token that never matches a two-word query.
      const tokens = tokenize('PaymentIntent')
      expect(tokens).toContain('payment')
      expect(tokens).toContain('intent')
      expect(tokens).not.toContain('paymentintent')
    })

    it('tokenize splits multi-word camelCase correctly', () => {
      const tokens = tokenize('CreatePaymentMethodRequest')
      expect(tokens).toContain('payment')
      expect(tokens).toContain('method')
      // Verify the input was split into multiple tokens, not kept as one opaque blob
      expect(tokens).not.toContain('createpaymentmethodrequest')
    })
  })

  describe('intent classification (Bug 1)', () => {
    it('GET api resolver → retrieval', () => {
      const getManifest = generate({
        app: 'test', capabilities: [{
          id: 'get_orders', name: 'Get orders', description: 'List all orders.',
          examples: ['get orders'], params: [], returns: ['orders'],
          resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/orders' }] },
          privacy: { level: 'public' },
        }],
      })
      const result = match('get orders', getManifest)
      expect(result.intent).toBe('retrieval')
    })

    it('POST api resolver → action', () => {
      const postManifest = generate({
        app: 'test', capabilities: [{
          id: 'create_order', name: 'Create order', description: 'Create a new order.',
          examples: ['create order', 'place order', 'add new order'], params: [], returns: ['order'],
          resolver: { type: 'api', endpoints: [{ method: 'POST', path: '/orders' }] },
          privacy: { level: 'public' },
        }],
      })
      const result = match('create order', postManifest)
      expect(result.intent).toBe('action')
    })

    it('DELETE api resolver → action', () => {
      const deleteManifest = generate({
        app: 'test', capabilities: [{
          id: 'delete_order', name: 'Delete order', description: 'Delete an order.',
          examples: ['delete order', 'remove order'], params: [], returns: ['status'],
          resolver: { type: 'api', endpoints: [{ method: 'DELETE', path: '/orders/{id}' }] },
          privacy: { level: 'public' },
        }],
      })
      const result = match('delete order', deleteManifest)
      expect(result.intent).toBe('action')
    })

    it('nav resolver always → navigation', () => {
      const result = match('Take me to dashboard', manifest)
      expect(result.intent).toBe('navigation')
    })
  })

  describe('deprecated capability scoring (Bug 6)', () => {
    it('deprecated capability scores lower than an active equivalent', () => {
      const mixedManifest = generate({
        app: 'test', capabilities: [
          {
            id: 'post_charges',
            name: 'Create charge',
            description: 'Create a charge.',
            examples: ['create charge', 'charge card', 'add charge'],
            params: [], returns: ['charge'],
            resolver: { type: 'api', endpoints: [{ method: 'POST', path: '/charges' }] },
            privacy: { level: 'public' },
            lifecycle: { status: 'deprecated' },
          },
          {
            id: 'create_payment_intent',
            name: 'Create payment intent',
            description: 'Create a payment intent to collect payment.',
            examples: ['create payment intent', 'charge card', 'add charge'],
            params: [], returns: ['payment_intent'],
            resolver: { type: 'api', endpoints: [{ method: 'POST', path: '/payment_intents' }] },
            privacy: { level: 'public' },
          },
        ],
      })
      const result = match('add charge', mixedManifest)
      const deprecated = result.candidates.find(c => c.capabilityId === 'post_charges')
      const active     = result.candidates.find(c => c.capabilityId === 'create_payment_intent')
      // Active alternative should outrank the deprecated capability
      expect(active!.score).toBeGreaterThan(deprecated!.score)
    })
  })

  describe('filterByTags', () => {
    const taggedManifest = generate({
      app: 'test-app',
      baseUrl: 'https://api.test.com',
      capabilities: [
        {
          id: 'get_orders', name: 'Get orders', description: 'Get user orders.',
          examples: ['show orders'], params: [], returns: ['orders'],
          resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/orders' }] },
          privacy: { level: 'public' }, tags: ['orders', 'read'],
        },
        {
          id: 'cancel_order', name: 'Cancel order', description: 'Cancel an order.',
          examples: ['cancel order'], params: [], returns: ['status'],
          resolver: { type: 'api', endpoints: [{ method: 'DELETE', path: '/orders/{id}' }] },
          privacy: { level: 'user_owned' }, tags: ['orders', 'write'],
        },
        {
          id: 'get_articles', name: 'Get articles', description: 'Get articles.',
          examples: ['show articles'], params: [], returns: ['articles'],
          resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/articles' }] },
          privacy: { level: 'public' }, tags: ['content'],
        },
        {
          id: 'no_tags', name: 'No tags', description: 'Capability without tags.',
          examples: ['do thing'], params: [], returns: ['result'],
          resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/thing' }] },
          privacy: { level: 'public' },
        },
      ],
    })

    it('filters to capabilities matching a single tag', () => {
      const filtered = filterByTags(taggedManifest, ['orders'])
      expect(filtered.capabilities.map(c => c.id)).toEqual(['get_orders', 'cancel_order'])
    })

    it('filters to capabilities matching all tags (intersection)', () => {
      const filtered = filterByTags(taggedManifest, ['orders', 'write'])
      expect(filtered.capabilities.map(c => c.id)).toEqual(['cancel_order'])
    })

    it('excludes capabilities without tags when filter is active', () => {
      const filtered = filterByTags(taggedManifest, ['orders'])
      expect(filtered.capabilities.find(c => c.id === 'no_tags')).toBeUndefined()
    })

    it('returns full manifest when no tags provided', () => {
      const filtered = filterByTags(taggedManifest, [])
      expect(filtered.capabilities.length).toBe(taggedManifest.capabilities.length)
    })

    it('preserves manifest metadata on filtered result', () => {
      const filtered = filterByTags(taggedManifest, ['content'])
      expect(filtered.app).toBe(taggedManifest.app)
      expect(filtered.schemaVersion).toBe(taggedManifest.schemaVersion)
      expect(filtered.capabilities.length).toBe(1)
    })
  })

  describe('type-implied extraction', () => {
    it('extracts email via type without pattern field', () => {
      const cap = generate({
        app: 'test', baseUrl: 'https://api.test.com',
        capabilities: [{
          id: 'send_email', name: 'Send email', description: 'Send an email.',
          examples: ['send email'], params: [{
            name: 'recipient', description: 'Email address', required: true,
            source: 'user_query', type: 'email',
          }], returns: ['status'],
          resolver: { type: 'api', endpoints: [{ method: 'POST', path: '/email' }] },
          privacy: { level: 'public' },
        }],
      }).capabilities[0]

      const params = extractParams('send email to john@example.com', cap)
      expect(params.recipient).toBe('john@example.com')
    })

    it('rejects enum value not in allowed list', () => {
      const cap = generate({
        app: 'test', baseUrl: 'https://api.test.com',
        capabilities: [{
          id: 'set_status', name: 'Set status', description: 'Set order status.',
          examples: ['set status'], params: [{
            name: 'status', description: 'Order status', required: true,
            source: 'user_query', type: 'enum', enum: ['pending', 'shipped', 'delivered'],
          }], returns: ['result'],
          resolver: { type: 'api', endpoints: [{ method: 'POST', path: '/status' }] },
          privacy: { level: 'public' },
        }],
      }).capabilities[0]

      // 'cancelled' not in enum → null
      const params = extractParams('set status to cancelled', cap)
      expect(params.status).toBeNull()

      // 'shipped' is in enum → extracted
      const params2 = extractParams('set status to shipped', cap)
      expect(params2.status).toBe('shipped')
    })
  })
  
})