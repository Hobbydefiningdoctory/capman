# capman

**Capability Manifest Engine** — let AI agents interact with your app reliably and explainably.

Instead of an AI blindly clicking through screens, capman gives it a structured map of what your app can do — and shows you exactly why it made every decision.

```bash
npm install capman
```

---

## The Problem

When an AI agent answers *"are there seats available Friday?"*, today it navigates your app like a tourist with no map:

```
AI clicks → Home → Explore → Events → Category → Availability
```

Slow. Wasteful. Touches screens it shouldn't.

## The Solution

Your app publishes a **capability manifest** — a machine-readable list of everything it can do, what API to call, and what data is allowed. The AI reads the manifest and goes directly to the answer.

```
User query → match capability → resolve via API or nav → structured result
```

---

## Quick Start

**1. Create your manifest config**

```bash
npx capman init
```

Edit `capman.config.js` to define your app's capabilities.

**2. Generate the manifest**

```bash
npx capman generate
```

**3. Use the engine in your AI agent**

```typescript
import { CapmanEngine, readManifest } from 'capman'

const manifest = readManifest()

const engine = new CapmanEngine({
  manifest,
  baseUrl: 'https://api.your-app.com',
})

const result = await engine.ask('Check availability for blue jacket')

console.log(result.match.capability?.id)    // 'check_product_availability'
console.log(result.resolution.apiCalls)     // [{ method: 'GET', url: '...' }]
console.log(result.resolvedVia)             // 'keyword' | 'llm' | 'cache'
console.log(result.trace.reasoning)         // ['Matched "check_product_availability" with 100% confidence', ...]
```

**4. See it live**

```bash
npx capman demo
```

---

## Execution Trace

Every `engine.ask()` call returns a full execution trace — so you always know why the AI did what it did.

```typescript
const result = await engine.ask('Check availability for blue jacket')

console.log(result.trace)
// {
//   query: 'Check availability for blue jacket',
//   candidates: [
//     { capabilityId: 'check_product_availability', score: 100, matched: true },
//     { capabilityId: 'get_order_status', score: 12, matched: false },
//     { capabilityId: 'navigate_to_screen', score: 0, matched: false },
//   ],
//   reasoning: [
//     'Matched "check_product_availability" with 100% confidence',
//     'Rejected: get_order_status (12%)',
//     'Resolved via: keyword',
//     'Extracted params: product=blue-jacket',
//   ],
//   steps: [
//     { type: 'cache_check',    status: 'miss', durationMs: 0 },
//     { type: 'keyword_match',  status: 'pass', durationMs: 1, detail: 'confidence: 100%' },
//     { type: 'privacy_check',  status: 'pass', durationMs: 0, detail: 'level: public' },
//     { type: 'resolve',        status: 'pass', durationMs: 2, detail: 'via api' },
//   ],
//   resolvedVia: 'keyword',
//   totalMs: 4,
// }
```

Debug any query from the CLI:

```bash
npx capman run "check availability for blue jacket" --debug
```

```
✓  Matched: check_product_availability
   Intent:     retrieval
   Confidence: 100%
   Resolver:   api
   Params:     product=blue-jacket

── All candidates:
   ✓  check_product_availability: 100%
   ○  get_order_status: 12%
   ○  navigate_to_screen: 0%
```

---

## Matching Modes

Control the cost/accuracy tradeoff with three matching modes:

```typescript
// cheap — keyword only, no LLM, free
const engine = new CapmanEngine({ manifest, mode: 'cheap' })

// balanced — keyword first, LLM fallback if confidence < 50% (default)
const engine = new CapmanEngine({ manifest, mode: 'balanced', llm: myLLM })

// accurate — LLM first, keyword fallback
const engine = new CapmanEngine({ manifest, mode: 'accurate', llm: myLLM })
```

Pass any LLM function — works with Anthropic, OpenAI, or any model:

```typescript
import Anthropic from '@anthropic-ai/sdk'
const anthropic = new Anthropic()

const engine = new CapmanEngine({
  manifest,
  mode: 'balanced',
  llm: async (prompt) => {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    })
    return res.content[0].text
  },
})
```

---

## Caching + Learning

```typescript
import { CapmanEngine, FileCache, FileLearningStore } from 'capman'

const engine = new CapmanEngine({
  manifest,
  // Default: MemoryCache (fast, resets on restart)
  // For persistence across restarts:
  cache:    new FileCache('.capman/cache.json'),
  learning: new FileLearningStore('.capman/learning.json'),
})

// After real usage, see what's happening
const stats = await engine.getStats()
console.log(stats)
// {
//   totalQueries: 142,
//   llmQueries:   18,
//   cacheHits:    67,
//   outOfScope:   3,
//   index: { 'availability': { 'check_product_availability': 34 }, ... }
// }

const top = await engine.getTopCapabilities(3)
// [
//   { id: 'check_product_availability', hits: 58 },
//   { id: 'navigate_to_screen',         hits: 41 },
//   { id: 'get_order_status',           hits: 28 },
// ]
```

---

## Privacy + Auth

Privacy scope is enforced **per capability**, before resolution happens:

```typescript
const engine = new CapmanEngine({
  manifest,
  baseUrl: 'https://api.your-app.com',
  auth: {
    isAuthenticated: true,
    role: 'user',
    userId: 'user-123',  // auto-injected into session params
  },
})

// user_owned capabilities require auth — blocked without it
// admin capabilities require role: 'admin' — blocked for regular users
// session params like {user_id} are auto-replaced from auth.userId
```

---

## Resolver Hardening

Configure retries and timeouts per call:

```typescript
const result = await engine.ask('show my orders', {
  retries:   2,        // retry failed requests (default: 0)
  timeoutMs: 3000,     // abort after 3 seconds (default: 5000)
})
```

---

## Capability Config

Each capability in `capman.config.js`:

```javascript
module.exports = {
  app: 'your-app',
  baseUrl: 'https://api.your-app.com',
  capabilities: [
    {
      id: 'check_product_availability',
      name: 'Check product availability',
      description: 'Check stock and pricing for a product by name or ID.',
      examples: [
        'Is the blue jacket available?',
        'Check availability for product 42',
        'Do you have size M in stock?',
      ],
      params: [
        {
          name: 'product',
          description: 'Product name or ID',
          required: true,
          source: 'user_query',   // extracted from the query
        },
      ],
      returns: ['stock', 'price', 'variants'],
      resolver: {
        type: 'api',              // 'api' | 'nav' | 'hybrid'
        endpoints: [
          { method: 'GET', path: '/products/{product}/availability' },
        ],
      },
      privacy: {
        level: 'public',          // 'public' | 'user_owned' | 'admin'
        note: 'No auth required',
      },
    },
  ],
}
```

---

## CLI Commands

| Command | What it does |
|---|---|
| `capman init` | Create a starter `capman.config.js` |
| `capman generate` | Generate `manifest.json` from config |
| `capman validate` | Validate your manifest for errors |
| `capman inspect` | Print all capabilities in the manifest |
| `capman run "query"` | Run a query against your manifest |
| `capman run "query" --debug` | Run with full candidate scoring |
| `capman demo` | Live demo with a sample app |

---

## Resolver Types

| Type | When to use |
|---|---|
| `api` | Answer lives in a backend API call |
| `nav` | User needs to be routed to a screen |
| `hybrid` | Both — fetch data AND navigate |

---

## Privacy Scopes

| Level | Meaning |
|---|---|
| `public` | No auth required |
| `user_owned` | Requires auth, scoped to current user only |
| `admin` | Restricted to admin roles |

---

## Param Sources

| Source | Meaning |
|---|---|
| `user_query` | Extracted from the user's query |
| `session` | Injected from `auth.userId` automatically |
| `context` | Provided by the caller |
| `static` | Fixed value, never changes |

---

## Honest Limits

**Works well:**
- Structured data retrieval via APIs
- Navigating to known app screens
- Multi-endpoint aggregation
- Privacy enforcement per capability
- Caching repeated queries
- Full execution tracing and debugging

**Current limits:**
- Real-time infra status (is the server down?)
- UI-only state with no API backing
- Very ambiguous queries — use `mode: 'accurate'` with an LLM
- Cross-app orchestration (planned)

---

## License

MIT — [github.com/Hobbydefiningdoctory/capman](https://github.com/Hobbydefiningdoctory/capman)