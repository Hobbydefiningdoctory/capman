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

**1. Generate your manifest — three ways:**

```bash
# From an OpenAPI/Swagger spec (fastest, no API key needed)
npx capman generate --from openapi.json
npx capman generate --from https://api.your-app.com/openapi.json

# AI-assisted — describe your app in plain English
npx capman generate --ai

# Manual — edit capman.config.js yourself
npx capman init
```

**2. Use the engine in your AI agent**

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

**3. See it live**

```bash
npx capman demo
```

---

## Manifest Generation

capman gives you three ways to create your manifest — pick based on what you have:

### From OpenAPI / Swagger spec

If your backend has an OpenAPI spec (most do), capman reads it and generates a complete manifest automatically. No LLM needed, no API key, works offline.

```bash
npx capman generate --from openapi.json
npx capman generate --from https://api.your-app.com/openapi.json
```

What it does automatically:
- Converts every endpoint into a capability with correct ID, name, and description
- Extracts path params, query params, and request body fields
- Infers privacy scope from security schemes — bearer token → `user_owned`, admin tags → `admin`, no auth → `public`
- Generates natural language examples from the operation summary
- Writes a ready `capman.config.js` for you to review and adjust

```
✓ Parsed 19 capabilities from spec
✓ Config written to capman.config.js
✓ Manifest written to manifest.json
```

### AI-assisted generation

No OpenAPI spec? Describe your app in plain English and capman uses an LLM to generate a full manifest.

```bash
npx capman generate --ai
```

```
Describe your app and its main capabilities:
> A SaaS CRM. Users can create contacts, log calls, view pipeline
  stages. Admins can manage teams and billing.

Using anthropic to generate manifest...
✓ 6 capabilities generated
```

Requires one of: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `OPENROUTER_API_KEY` in your environment.

### Manual

For full control, start from a starter config and define capabilities yourself:

```bash
npx capman init
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
  cache:    new FileCache('.capman/cache.json'),
  learning: new FileLearningStore('.capman/learning.json'),
})

const stats = await engine.getStats()
// { totalQueries: 142, llmQueries: 18, cacheHits: 67, outOfScope: 3 }

const top = await engine.getTopCapabilities(3)
// [{ id: 'check_product_availability', hits: 58 }, ...]
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
```

---

## Resolver Hardening

```typescript
const result = await engine.ask('show my orders', {
  retries:   2,
  timeoutMs: 3000,
})
```

---

## CLI Commands

| Command | What it does |
|---|---|
| `capman init` | Create a starter `capman.config.js` |
| `capman generate` | Generate manifest from `capman.config.js` |
| `capman generate --from <path\|url>` | Generate from OpenAPI/Swagger spec |
| `capman generate --ai` | Generate manifest using AI |
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
- Auto-generating manifests from OpenAPI specs
- Privacy enforcement per capability
- Full execution tracing and debugging
- Caching repeated queries

**Current limits:**
- Real-time infra status (is the server down?)
- UI-only state with no API backing
- Very ambiguous queries — use `mode: 'accurate'` with an LLM
- Multi-instance deployments need Redis adapter (planned for v0.5)

---

## License

MIT — [github.com/Hobbydefiningdoctory/capman]