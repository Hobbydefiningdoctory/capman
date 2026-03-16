# Capman — Capability Manifest Engine

Let AI agents interact with your app **without navigating the UI**.

Instead of an AI blindly clicking through screens to find information,
capman lets your app declare what it can do — and the AI uses that map
to get answers directly.

---

## The Problem

When an AI agent needs to answer "are there available seats for Friday?",
today it navigates your entire app like a tourist with no map:

```
AI clicks → Home → Explore → Events → Category → Detail → Availability
```

That's slow, wasteful, and exposes parts of your app the AI shouldn't see.

## The Solution

Your app publishes a **capability manifest** — a machine-readable list of
everything it can do, what API to call, and what data scope is allowed.

The AI reads the manifest and goes directly to the answer.

```
User query → match capability → resolve via API or nav → done
```

---

## Install

```bash
npm install capman
```

---

## Quick Start

**1. Create a config file**

```bash
npx capman init
```

This creates a `capman.config.js` in your project. Edit it to define
your app's capabilities.

**2. Generate the manifest**

```bash
npx capman generate
```

This reads your config and outputs a `manifest.json`.

**3. Use the SDK in your AI agent**

```typescript
import { match, resolve, readManifest } from 'capman'

const manifest = readManifest()

// Match a user query to a capability
const matchResult = match("show me my account details", manifest)

// Resolve it
const result = await resolve(matchResult, {}, {
  baseUrl: 'https://api.your-app.com'
})

console.log(result.apiCalls)  // [{ method: 'GET', url: '...' }]
console.log(result.navTarget) // '/dashboard/profile'
```

---

## CLI Commands

| Command | What it does |
|---|---|
| `capman init` | Create a starter `capman.config.js` |
| `capman generate` | Generate `manifest.json` from config |
| `capman validate` | Validate your manifest for errors |
| `capman inspect` | Print all capabilities in the manifest |

---

## SDK Reference

### `match(query, manifest)`
Matches a user query to the best capability using keyword scoring.
Returns a `MatchResult` with the capability, confidence score, and intent.

### `matchWithLLM(query, manifest, { llm })`
Same as `match()` but uses an LLM for higher accuracy on ambiguous queries.
Pass in any LLM function — works with Anthropic, OpenAI, or any local model.

```typescript
const result = await matchWithLLM("find me something", manifest, {
  llm: async (prompt) => {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    })
    return res.content[0].text
  }
})
```

### `resolve(matchResult, params, options)`
Executes a matched capability via API call, navigation, or both.

### `ask(query, manifest, options)`
Convenience function — match + resolve in one call.

```typescript
const { match, resolution } = await ask("go to settings", manifest)
```

---

## Capability Config

Each capability in your `capman.config.js` looks like this:

```javascript
{
  id: 'get_resource',
  name: 'Get a resource',
  description: 'Fetch a resource by ID or name.',  // used for matching
  examples: [                                        // improves accuracy
    'Show me resource details',
    'Find resource by ID',
  ],
  params: [
    {
      name: 'resource_id',
      description: 'The resource ID',
      required: true,
      source: 'user_query',  // or 'session', 'context', 'static'
    }
  ],
  returns: ['resource', 'metadata'],
  resolver: {
    type: 'api',             // 'api', 'nav', or 'hybrid'
    endpoints: [
      { method: 'GET', path: '/resources/{resource_id}' }
    ],
  },
  privacy: {
    level: 'public',         // 'public', 'user_owned', or 'admin'
    note: 'No auth required'
  }
}
```

---

## Privacy Scopes

| Level | Meaning |
|---|---|
| `public` | No auth required |
| `user_owned` | Requires auth, scoped to current user only |
| `admin` | Restricted to admin roles |

Privacy scope is declared **per capability** — the AI is scoped to only
what each capability allows, before resolution happens.

---

## Resolver Types

| Type | When to use |
|---|---|
| `api` | Answer lives in a backend API call |
| `nav` | User needs to be routed to a screen |
| `hybrid` | Both — fetch data AND navigate |

---

## Honest Limits

**Works well:**
- Structured data retrieval via APIs
- Navigating to known app screens
- Multi-endpoint aggregation
- Privacy scoping per capability
- Auto-updating on deploy

**Current limits:**
- Real-time infra status (is the server down?)
- UI-only state with no API backing
- Cross-app orchestration
- Very ambiguous queries without LLM matcher

---

## License

MIT
