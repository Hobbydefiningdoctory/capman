# Concurrency Guide

capman is a single-threaded Node.js library. Classical data races (two threads
writing memory simultaneously) do not apply. What does apply is **async
interleaving** — two `await` chains can interleave at suspension points when a
single `CapmanEngine` instance is shared across concurrent request handlers.

---

## What is safe

- **Multiple engine instances** — each request creates its own `CapmanEngine`.
  No shared state, no interleaving possible.
- **Shared instance in `cheap` mode** — no LLM calls means no long-running
  async chains. Synchronous operations (BM25 scoring, cache reads) cannot
  interleave within the event loop.
- **Calling `loadManifest()` on a shared instance** — guarded by an optimistic
  `manifestVersion` counter. In-flight `ask()` calls that complete after a
  manifest swap skip their cache write rather than polluting it with stale data.
- **`MemoryCache` mutations, counter increments** — synchronous within the event
  loop. Cannot interleave.

## What is unsafe

- **Shared instance in `balanced` or `accurate` mode with concurrent requests**
  — LLM rate limiter and circuit-breaker state can interleave across concurrent
  `ask()` calls.
- **Calling `loadManifest()` while `ask()` calls are in flight with caching
  enabled** — mitigated by the `manifestVersion` guard, but results computed
  against the old manifest are silently dropped from cache. Use
  `ConcurrentCapmanEngine` if you need to avoid dropped writes entirely.

---

## The three patterns

### Pattern A — Per-request engine (recommended for most servers)

Create a new `CapmanEngine` per request. The manifest is loaded once at startup
and reused across engines — `CapmanEngine` does not mutate the manifest object.

```typescript
import { readManifest } from 'capman'
import { CapmanEngine } from 'capman'

const manifest = readManifest('./capman.manifest.json')

app.post('/ask', async (req, res) => {
  const engine = new CapmanEngine({ manifest, llm: myLLM, mode: 'balanced' })
  const result = await engine.ask(req.body.query)
  res.json(result)
})
```

**When to use:** Any server where `CapmanEngine` construction is cheap relative
to request handling time. Recommended default.

**Trade-off:** No learning state accumulates across requests. Use
`FileLearningStore` passed explicitly to each engine if persistence matters.

---

### Pattern B — Shared instance with `ConcurrentCapmanEngine`

Use when you need a single long-lived engine with accumulated learning state,
LLM call history, or an in-memory cache shared across requests.

```typescript
import { ConcurrentCapmanEngine } from 'capman'

const engine = new ConcurrentCapmanEngine({
  manifest,
  llm:      myLLM,
  mode:     'balanced',
  learning: new FileLearningStore('.capman/learning.json'),
})

app.post('/ask', async (req, res) => {
  const result = await engine.ask(req.body.query)
  res.json(result)
})
```

`ConcurrentCapmanEngine` serialises `ask()` and `explain()` calls via an
internal promise queue — FIFO, zero external dependencies. One request runs at
a time; others wait in queue.

**When to use:** Long-lived servers where learning accumulation or a warm
in-memory cache provides meaningful value and you are willing to accept
serialised throughput for LLM-mode calls.

**Trade-off:** Requests queue behind each other. Under high concurrency with
slow LLM providers this increases tail latency. Profile before committing.

---

### Pattern C — Shared instance in cheap mode

`cheap` mode performs only BM25 + RRF scoring — fully synchronous, sub-millisecond,
no LLM calls. A single shared instance is safe without any wrapper.

```typescript
const engine = new CapmanEngine({ manifest, mode: 'cheap' })

app.post('/ask', async (req, res) => {
  const result = await engine.ask(req.body.query)
  res.json(result)
})
```

**When to use:** High-throughput routing, intent classification, or any
scenario where keyword matching is sufficient and latency must be minimal.

**Trade-off:** No LLM fallback. Ambiguous or paraphrased queries that BM25
misses will return `out_of_scope` rather than escalating to an LLM.

---

## Choosing a pattern

| Scenario | Pattern |
|---|---|
| Serverless / short-lived process | A — per-request |
| Server, LLM mode, learning matters | B — `ConcurrentCapmanEngine` |
| Server, no LLM, maximum throughput | C — cheap mode shared |
| CLI tool | A — single instance, no concurrency |
| `loadManifest()` called at runtime | B — wrapper absorbs the version guard |

---

## `ConcurrentCapmanEngine` API

Identical surface to `CapmanEngine`. Drop-in replacement for shared-instance
server use.

```typescript
import { ConcurrentCapmanEngine, type EngineOptions } from 'capman'

const engine = new ConcurrentCapmanEngine(options: EngineOptions)

engine.ask(query, overrides?)       // serialised
engine.explain(query)               // serialised
engine.loadManifest(manifest)       // delegated directly
engine.getStats()                   // delegated directly
engine.getTopCapabilities(limit?)   // delegated directly
engine.clearCache()                 // delegated directly
```

`ask()` and `explain()` are the only methods serialised. All other methods are
delegated directly to the underlying `CapmanEngine` — they are either read-only
or internally safe.

A failed `ask()` or `explain()` does not block subsequent calls — the queue
resets to resolved on rejection so one bad request cannot stall the server.