# capman

**Give your AI agent a map of your app — instead of letting it click around blindly.**

Instead of navigating your UI screen by screen, your agent reads a structured manifest of everything your app can do and goes directly to the right API call. No guessing. No unnecessary clicks. Full transparency into every decision.

```bash
npm install capman
```

---

## The Problem

When an AI agent answers *"are there seats available Friday?"*, today it navigates your app like a tourist:

```
AI clicks → Home → Explore → Events → Category → Availability
```

Slow. Wasteful. Touches screens it shouldn't.

## The Solution

Your app publishes a **capability manifest** — a machine-readable list of what it can do, what API to call, and what data it's allowed to touch. The agent reads the manifest and goes directly to the answer.

```
User query → match capability → call API → structured result
```

---

## Quick Start

**1. Generate your manifest**

```bash
# From an existing OpenAPI/Swagger spec (no API key needed)
npx capman generate --from openapi.json
npx capman generate --from https://api.your-app.com/openapi.json

# Or let an LLM write it from a plain-English description
npx capman generate --ai

# Or start from a blank config and write it yourself
npx capman init
```

**2. Use the engine in your agent**

```typescript
import { CapmanEngine, readManifest } from 'capman'

const engine = new CapmanEngine({
  manifest: readManifest(),
  baseUrl:  'https://api.your-app.com',
})

const result = await engine.ask('Check availability for blue jacket')

console.log(result.match.capability?.id)   // 'check_product_availability'
console.log(result.resolution.apiCalls)    // [{ method: 'GET', url: '...' }]
console.log(result.resolvedVia)            // 'keyword' | 'llm' | 'cache'
console.log(result.verdict)               // 'clear' | 'marginal' | 'uncertain'
console.log(result.trace.reasoning)       // ['Matched with 100% confidence', ...]
```

**3. Try it live**

```bash
npx capman demo
```

---

## How Matching Works

capman runs a three-tier cascade on every query:

```
BM25 keyword match
      ↓  (if confidence < 50%)
Optional fuzzy match (typos, paraphrases)
      ↓  (if still low confidence)
LLM fallback (balanced/accurate modes)
```

Three modes — you choose the cost/accuracy tradeoff:

```typescript
// keyword only — free, sub-millisecond
new CapmanEngine({ manifest, mode: 'cheap' })

// keyword first, LLM fallback — recommended default
new CapmanEngine({ manifest, mode: 'balanced', llm: myLLM })

// LLM first, keyword fallback — maximum accuracy
new CapmanEngine({ manifest, mode: 'accurate', llm: myLLM })
```

Pass any LLM — Anthropic, OpenAI, or anything that takes a string and returns a string.

---

## Auth and Multi-User Servers

For multi-user servers, always pass `auth` per request — never at engine construction time. A shared engine with one `auth` context serves every user as the same person.

```typescript
// ✓ Correct — per-request auth
app.post('/ask', async (req, res) => {
  const result = await engine.ask(req.body.query, {
    auth:    { isAuthenticated: true, userId: req.user.id, role: req.user.role },
    headers: { 'Authorization': `Bearer ${req.user.token}` },
  })
  res.json(result)
})

// ✗ Wrong for multi-user — engine shares one auth context across all callers
const engine = new CapmanEngine({ manifest, auth: { isAuthenticated: true } })
```

**Important:** capman uses `auth` to gate whether a capability is allowed to run. It does **not** automatically forward credentials to your API. Add an `Authorization` header (or equivalent) via the `headers` override — your backend needs proof of who the caller is.


---

## What You Get Back

Every `ask()` call returns more than just an API result:

```typescript
result.match.capability      // what was matched (or null)
result.match.confidence      // 0–100 score
result.resolution.apiCalls   // the actual HTTP calls made
result.resolvedVia           // 'keyword' | 'llm' | 'cache'
result.verdict               // 'clear' | 'marginal' | 'uncertain'
result.missingParams         // params the agent should ask the user for
result.trace                 // full step-by-step execution breakdown
```

`verdict` tells your agent whether to proceed confidently (`clear`), ask the user to confirm (`marginal`), or say it's not sure (`uncertain`). `missingParams` tells it exactly what to ask for when a required parameter couldn't be extracted.

---

## Key Features

- **Three manifest generators** — OpenAPI import, AI-assisted, or manual
- **Execution trace on every query** — keyword scores, LLM reasoning, timing, all visible
- **explain()** — see what would happen without executing it, with per-candidate score explanations
- **health()** — snapshot of circuit breaker state, LLM quota, cache, learning, embedding readiness
- **Pluggable caching** — memory, file-backed, or memory+file combo with optional TTL
- **Learning that improves over time** — usage signals boost matching; time-decay keeps it fresh
- **Privacy enforcement per capability** — `public / user_owned / admin` checked before any API call
- **Capability lifecycle** — `stable / beta / experimental / deprecated` with sunset dates and successors
- **Structured error registry** — document what errors a capability returns, surface them on failure
- **Semantic embedding support** — bring your own embedding model for richer matching
- **LLM protection** — rate limiting, per-call cooldown, and circuit breaker built in
- **Safe concurrency** — three documented patterns including `ConcurrentCapmanEngine` for shared instances

See [CODEBASE.md](./CODEBASE.md) for the full technical reference — every option, every field, every internal decision.

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
| `capman explain "query"` | Show what would match and why — without executing |
| `capman run "query"` | Run a query against your manifest |
| `capman run "query" --debug` | Run with full candidate scoring |
| `capman demo` | Live demo with a sample app |

---

## Honest Limits

**Works well:**
- Structured data retrieval via APIs
- Auto-generating manifests from OpenAPI specs
- Privacy enforcement before any API call is made
- Full tracing so you always know what happened and why
- Caching and learning that improve over time

**Current limits:**
- Real-time infra status ("is the server down?") — capman calls APIs, it doesn't monitor them
- UI-only state with no API backing — if there's no API, there's nothing to call
- Very ambiguous queries with no keyword signal — use `mode: 'accurate'` or `fuzzyMatch: true`
- Multi-instance deployments: `FileCache` and `FileLearningStore` are single-instance only — concurrent writers will corrupt the file
- `FileLearningStore` saves are debounced — up to 5 seconds of data could be lost on `SIGKILL` (SIGTERM/SIGINT are handled gracefully)
- Multi-endpoint capabilities: if one endpoint fails mid-flight, side effects from successful endpoints can't be rolled back

---

## License

MIT — [github.com/Hobbydefiningdoctory/capman](https://github.com/Hobbydefiningdoctory/capman.git)