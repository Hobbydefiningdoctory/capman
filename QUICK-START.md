# Quick Start

This guide gets you from "what is capman?" to "my AI agent can use my app" — no prior experience needed.

---

## What does this actually do?

You have an app with an API (a way for code to talk to it). You want an AI agent (like a chatbot or assistant) to be able to *do things* in your app — check an order status, look up a product, create a booking — based on what a user types in plain English.

capman reads a list of "things your app can do" and matches a user's question to the right one automatically.

```
User types: "is the blue jacket in stock?"
        ↓
capman figures out: "they want check_product_availability"
        ↓
capman calls your API and returns the answer
```

That's it. The rest of this guide is just *how to set that up*.

---

## Step 1 — Install

Open a terminal in your project folder and run:

```bash
npm install capman
```

You'll see a message saying packages were installed. That's success — move on.

---

## Step 2 — Tell capman what your app can do

There are two ways to do this. Pick whichever matches your situation.

### Option A — You already have an OpenAPI/Swagger file

If your app already has a file that describes your API (often called `openapi.json`, `swagger.json`, or available at a URL like `https://yourapp.com/openapi.json`), capman can read it automatically:

```bash
npx capman generate --from openapi.json
```

or, if it's a URL:

```bash
npx capman generate --from https://yourapp.com/openapi.json
```

**What just happened?** capman read your API description and created a file called `manifest.json` — a list of everything your app can do, written in a way the AI agent can understand.

You'll see output like:

```
✓ Parsed 12 endpoints
✓ Generated manifest.json with 12 capabilities
```

If you see a number greater than 0, it worked. Skip to Step 3.

### Option B — You don't have an OpenAPI file (start from scratch)

```bash
npx capman init
```

This creates a file called `capman.config.js` — a plain JavaScript file where you describe what your app can do, by hand, one thing at a time.

Open it. You'll see something like this:

```javascript
module.exports = {
  app: 'my-app',
  baseUrl: 'https://api.myapp.com',
  capabilities: [
    {
      id: 'get_orders',
      name: 'Get orders',
      description: 'Fetch a list of the current user\'s orders.',
      examples: ['show me my orders', 'what did I order'],
      params: [],
      returns: ['orders'],
      resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/orders' }] },
      privacy: { level: 'user_owned' },
    },
  ],
}
```

Think of each entry in `capabilities` as one sentence describing one thing your app does:

- **`id`** — a short name, lowercase with underscores, like `get_orders`
- **`name`** — a human-friendly title
- **`description`** — one sentence explaining what it does (be specific — this is what the AI reads to decide if this is the right match)
- **`examples`** — 2-3 example phrases a real user might type
- **`params`** — anything the user needs to provide (like a product ID). Leave as `[]` if nothing's needed
- **`resolver`** — which API endpoint to call (`method` is `GET`, `POST`, etc., `path` is the URL path)
- **`privacy`** — who's allowed to use this: `'public'` (anyone), `'user_owned'` (logged-in users, their own data), or `'admin'` (admins only)

Copy that block, change the values to describe one thing your app does, and repeat for each capability. Don't worry about getting it perfect — you can run the next command as many times as you want.

Once you've described a few things, turn it into a manifest:

```bash
npx capman generate
```

You'll see:

```
✓ Generated manifest.json with 3 capabilities
```

---

## Step 3 — Check your work

Before connecting anything, make sure your manifest is valid:

```bash
npx capman validate
```

A good result looks like:

```
✓ Manifest is valid
3 capabilities — all valid
```

If you see warnings (⚠), don't panic — warnings are suggestions, not errors. A common one is *"no examples — matching accuracy will be lower"*. Add 2-3 example phrases to that capability and run `validate` again.

If you see errors (✗), the message tells you exactly what's wrong and how to fix it — e.g. *"capability id must be snake_case e.g. 'get_orders'"*.

---

## Step 4 — Try it out

Before writing any code, try asking it a question right from the terminal:

```bash
npx capman run "show me my orders"
```

You'll see something like:

```
Matched: get_orders (94% confidence)
Would call: GET https://api.myapp.com/orders
```

If it matched the right thing — great, you're ready for Step 5.

If it didn't match, or matched the wrong thing, try:

```bash
npx capman explain "show me my orders"
```

This shows you *why* it chose what it chose, and what else it considered. The usual fix is adding more example phrases to the capability's `examples` list, then running `npx capman generate` again.

---

## Step 5 — Use it in your code

Now connect it to your actual application:

```typescript
import { CapmanEngine, readManifest } from 'capman'

const engine = new CapmanEngine({
  manifest: readManifest(),       // reads manifest.json
  baseUrl:  'https://api.myapp.com',
})

const result = await engine.ask('show me my orders')

console.log(result.match.capability?.id)  // 'get_orders'
console.log(result.resolution.apiCalls)   // the actual API call that was made
```

That's the whole integration. `engine.ask(...)` takes whatever the user typed, figures out what they meant, and (if it's an action that calls your API) does it for you.

---

## Common Questions

**"Do I need an AI model / API key to use this?"**

No. The basic version (`mode: 'cheap'`, which is the default) works with zero AI — it's just smart keyword matching. If you want it to handle vague or unusual phrasing too, you can later add an AI model (see README for how), but it's optional.

**"What if the user asks something my app can't do?"**

capman returns `out_of_scope` — it won't guess or make something up. `result.match.capability` will be `null`. You can show the user a friendly "I can't help with that" message.

**"What if the user is logged in — how do I make sure they only see their own data?"**

That's what `privacy: { level: 'user_owned' }` is for. Pass who's currently logged in:

```typescript
const engine = new CapmanEngine({
  manifest: readManifest(),
  baseUrl:  'https://api.myapp.com',
  auth: { isAuthenticated: true, userId: currentUser.id },
})
```

capman checks this automatically before calling any `user_owned` or `admin` capability — if the check fails, it won't make the API call.

**"I changed my manifest — do I need to restart my app?"**

No:

```typescript
await engine.loadManifest(readManifest())
```

This reloads it live.

**"Something's not working — how do I check if capman is healthy?"**

```typescript
const status = await engine.health()
console.log(status.status)  // 'healthy' | 'degraded' | 'unhealthy'
```

---

## What's Next

You now have the basics. When you're ready to go further:

- **[README.md](./README.md)** — full feature list: AI fallback matching, fuzzy matching for typos, caching, learning over time
- **[CODEBASE.md](./CODEBASE.md)** — every option and setting explained, for when you need fine control
- **[CONCURRENCY.md](./CONCURRENCY.md)** — if you're building a server that many people use at once

Or just try the live demo:

```bash
npx capman demo
```
