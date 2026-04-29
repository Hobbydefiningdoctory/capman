# Changelog

All notable changes to capman are documented here.

---

## [0.5.4] — 2026-04-29
### Added
- `engine.loadManifest(manifest)` — hot-reloads the manifest without creating a new engine instance. Preserves cache, learning history, and rate limiter state. Clears cache automatically since cached results from the old manifest are no longer valid
- `fuzzyMatch` and `fuzzyThreshold` options in `EngineOptions` — opt-in Fuse.js fuzzy matching catches typos, slight paraphrases, and morphological variants that exact keyword matching misses. Disabled by default, never runs in `cheap` mode
- POSIX `--` sentinel support in CLI — `capman run -- "query"` and `capman explain -- "query"` now correctly handle queries that start with `--` or contain flag-like strings

### Fixed
- Example scoring now uses `Math.max` across examples instead of accumulating — a capability with 10 weak examples no longer beats one with a single precise example
- Fuse.js index built once per `match()` call using a flat corpus — each example/description/name is its own searchable entry, grouped by capability after search. Avoids the dead-weight property bug and multi-key aggregation issues from the previous implementation

### Tests
- 97 tests passing (up from 91)

---

## [0.5.3] — 2026-04-25
### Fixed
 
**Critical:**
- `.capman/` added to `.gitignore` — cache and learning files were being committed to git, exposing internal API path structures and cached match data
- Session `userId` no longer leaks into query string on multi-endpoint capabilities — path template check was joining all endpoint paths before checking for `{param}`, causing false positives. Now checks per-endpoint inside `resolveApi()`
- File writes are now atomic — `FileCache` and `FileLearningStore` write to a `.tmp` file then rename, preventing corrupt JSON on process crash mid-write
- `ask()` now caches only after successful resolution — previously cached match result before Step 5 (resolve), permanently poisoning the cache on transient network failures
  
**High:**
- API path params validated against allowlist in `buildUrl()` — `encodeURIComponent` does not encode `/`, allowing path traversal via params like `../../admin`. Now mirrors the validation already applied in `resolveNav()`
- Raw query text removed from `info`-level logs — queries like `"orders for jane@corp.com"` were emitted at info level to stdout. Query text now only appears at `debug` level
- Retry logic now only retries safe/idempotent methods (GET, HEAD, OPTIONS) — previously retried POST/PUT/PATCH/DELETE which could cause duplicate orders, double charges etc. Add `retryAllMethods: true` to `ResolveOptions` to opt in to retrying writes
- `FileCache` concurrent load guard added — two simultaneous `get()` calls before `loaded = true` both read the file. Now serialized through a shared `loadPromise`
  
**Medium:**
- Version comparison now validates semver format before parsing — `Number("v0")` → `NaN`, `NaN !== NaN` always true, causing spurious version warnings on every startup for non-semver manifest versions
- `LearningIndex` class extracted — `updateIndex`, `subtractFromIndex`, `rebuildIndex` were copy-pasted verbatim (~80 lines) between `FileLearningStore` and `MemoryLearningStore`. Both now compose `LearningIndex`
- `computeStats()` dead code removed — was only used by old `getStats()` before incremental index was introduced in v0.5.0
- `FileLearningStore` now debounces saves — previously wrote full JSON on every `record()` call (every `ask()`). Now batches with a 5s debounce timer and flushes synchronously on `process.exit`, `SIGTERM`, `SIGINT`
- YAML catch block now distinguishes `MODULE_NOT_FOUND` from actual parse errors using `err.code` — previously swallowed real YAML syntax errors with a generic message
- `baseUrl` now required by Zod schema when any capability uses `api` or `hybrid` resolver — previously optional, producing silent relative URLs that fail with opaque connection errors
- `explain()` now asserts `resolvedVia !== 'cache'` at runtime — makes the invariant that `explain()` never reads from cache explicit and catches future regressions immediately
- ESM config files now produce an actionable error — `ERR_REQUIRE_ESM` previously surfaced as a generic "Failed to load config" message with no guidance. Now explains the issue and lists three solutions
  
### Tests
- 90 tests passing

## [0.5.2] — 2026-04-20
### Fixed

**Critical:**
- `[from_session]` sentinel string replaced with `null` in `extractParams()` — was leaking literal `[from_session]` into API URLs and POST request bodies
- `resolveApi()` POST body now strips null params — session values that weren't injected no longer appear as `null` in request bodies
- `FileCache` and `FileLearningStore` constructors now validate path stays within working directory — prevents path traversal via caller-supplied `filePath`
- `FileCache.get()` no longer writes to disk on every cache hit — was triggering full JSON rewrite per request under any real load
- Cache hits now re-extract params from the current query — previously re-served `extractedParams` from the original cached query, leaking one user's param values to another

**High:**
- Query length and type guards added to `ask()` and `explain()` — throws `TypeError` for non-string input, `RangeError` for queries over 1000 characters
- `FileCache.load()` now normalizes keys on read — prevents duplicate entries from manual edits or older versions accumulating silently
- `matchWithLLM` now returns all capabilities as candidates with keyword scores as baseline — previously returned only the LLM winner, making learning boost unable to surface alternatives
- Manifest descriptions truncated to 200 chars and examples to 100 chars in LLM prompt — prevents context window overflow and reduces injection surface from third-party OpenAPI specs
- Zod schema now enforces `description` max 500 chars and `examples` max 200 chars per entry
- Template substitution uses `replaceAll` — `String.replace()` only replaced the first occurrence of a `{param}` placeholder, leaving duplicates unsubstituted
- TypeScript target bumped to ES2021 — enables `replaceAll`, aligns with minimum supported Node version

**Medium:**
- `MemoryLearningStore.rebuildIndex()` dead code removed — was defined but unreachable since `MemoryLearningStore` has no `load()` method
- `loadSpec()` in parser now uses `fs.promises.readFile` — was blocking event loop with synchronous `readFileSync` in an async function
- Raw query text no longer stored verbatim in learning entries — tokenized to keywords only before persisting, eliminates PII (emails, names, IDs) from `.capman/learning.json`
- `resolveApi()` JSDoc documents parallel execution and no-rollback behavior for multi-endpoint capabilities
- Version comparison now parses major/minor as integers — string comparison (`"0.10" > "0.9"`) is lexicographic and incorrect

### Tests
- 87 tests passing

## [0.5.1] — 2026-04-18
### Fixed

**Critical:**
- `getStats()` and `getIndex()` now return deep clones of the internal index — callers can no longer corrupt the learning store by mutating the returned object
- `FileCache` and `FileLearningStore` saves are now serialized through a promise queue — concurrent writes no longer silently drop entries via last-write-wins
- `clear()` now resets the incremental index and stats counters in both stores — previously left stale boost data after clearing

**High:**
- Session params (`source: 'session'`) no longer leak into API query strings — only injected when the param name appears as a `{template}` in the path
- `MemoryCache` and `FileCache` now use LRU eviction — previously used FIFO, evicting frequently-accessed entries ahead of cold ones
- Tiebreak logic in boost corrected — `b.matched` now correctly preserves original winner on tied scores (was `a.matched`, only worked when winner was first in array)
- LLM error logging now uses `err.message` instead of `${err}` — prevents potential API key exposure from SDK errors that embed auth headers in error objects

**Medium:**
- `rebuildIndex()` after pruning replaced with `subtractFromIndex()` — O(pruned × w) instead of O(n × w), avoids full index rebuild at the 10k entry cap
- `ask()` and `explain()` matching dispatch unified into `_runMatch()` — eliminates 60 lines of duplicated mode-switching logic
- Fallback param denylist extended — category nouns like `"orders"`, `"data"`, `"results"`, `"items"` no longer produce junk URLs
- File write errors now include the actual error message in the log — was silently swallowing `ENOSPC`, `EACCES` etc.
- `loadSpec()` fetch in parser now has a 10s timeout with `AbortController` — previously hung indefinitely on unresponsive URLs
- Cache entries now support optional TTL via `cacheTtlMs` in `EngineOptions` — stale entries from removed capabilities are expired on read
- `matchWithLLM` JSDoc documents the manifest injection surface — capability descriptions and examples are verbatim in the LLM prompt

### Tests
- 82 tests passing

## [0.5.0] — 2026-04-15
### Added
- Learning index is now incremental — `record()` updates the index in O(w) per entry instead of rebuilding from scratch on every `getStats()` call. Eliminates O(n) CPU spike on every query under load.
- `getIndex()` method on both `FileLearningStore` and `MemoryLearningStore` — returns live keyword index directly in O(1)
- `extractParams` exported from public API — enables direct param extraction without going through `match()`
- `resolverToIntent()` exported from public API — converts a capability's resolver type to its intent string
- `STOPWORDS` exported from public API — same set used by matcher and learning index

### Fixed

**Security:**
- Auth bypass via cache key — non-public capabilities are no longer cached. Previously User A's cached match for a `user_owned` capability could be served to User B before privacy checks ran
- Arbitrary file write via CLI — `--out` and `--config-out` flags in `capman generate` now validated against working directory. Path traversal attempts exit with a clear error
- Prompt injection hardening — system instructions now come before user data in `matchWithLLM` prompt, with explicit `USER_QUERY_START/END` delimiters

**Learning system:**
- Boost feedback loop — learning now records the pre-boost match result, not the post-boost winner
- Boosted winner no longer gets empty `extractedParams` — params extracted directly via `extractParams()`
- Cache now stores post-boost result — previously cache/live path could return different capabilities
- OOS results can no longer be promoted via boost alone — boost skipped when all candidates score 0
- Tied boost scores now preserve original winner
- Learning index no longer includes stopwords — words like `"show"`, `"get"`, `"for"` were inflating unrelated scores
- Boost logic deduplicated — `ask()` and `explain()` share `applyBoostToMatchResult()`

**Security — logs:**
- PII no longer logged at debug level — param values and `auth.userId` redacted as `[REDACTED]`

**Cache:**
- `FileCache` now has a 2048-entry cap with oldest-first eviction — previously grew without bound

**Resolver:**
- Nav params validated against allowlist before substitution — prevents open redirect via encoded path separators

**Matcher:**
- `JSON.parse` failures no longer trigger the circuit breaker — prefixed `LLM_PARSE_ERROR` and treated separately from network failures
- Required param fallback rejects generic nouns — only accepts identifier-shaped last words

**Engine:**
- Version compatibility warning now uses `console.warn` — was using `logger.warn` suppressed by default `'silent'` log level
- Version warning wording softened — advisory not mandatory
- Concurrency limitation documented in `EngineOptions` JSDoc and README

### Tests
- 80 tests passing (up from 73)
- Boost tests now use `mode: 'balanced'` — previously used `mode: 'cheap'` making them vacuous
- Nav open redirect test added

---

## [0.4.5] — 2026-04-08
### Added
- Learning index wired into keyword matcher — boost up to +15 points for historically matched capabilities
- Manifest version compatibility check — warns when manifest `major.minor` differs from engine version

### Fixed
- Dead logger warning condition in `matchWithLLM` corrected
- Empty string `userId` no longer injected into session params
- `resolverToIntent()` exported and reused in engine
- Learning boost skipped in `cheap` mode
- Boost logic applied consistently in both `ask()` and `explain()`

---

## [0.4.4] — 2026-04-05
### Fixed
- Rate limit double-counting on LLM failure — `recordLLMFailure()` no longer increments `llmCallsThisMinute` (slot already reserved by `checkLLMAllowed()`)
- Negative `windowResetIn` in rate limit message — recalculates elapsed after window reset
- Hallucinated capability ID from LLM now correctly returns `out_of_scope` with `confidence: 0` instead of contradictory state
- `null` params no longer written as literal `"null"` into API URLs or nav targets
- Empty string `userId` now correctly injected into session params (was skipped by falsy check)
- `FileCache` and `FileLearningStore` now validate JSON structure before loading — corrupt or unexpected format starts fresh with a warning instead of silently emptying
- `explain()` privacy check now mirrors `resolve()` exactly — unauthenticated admin access correctly reports "requires authentication" not "requires admin role"
- `getFlag()` in CLI now errors clearly when a flag is provided without a value (e.g. `--from` with no path)
- `toSnakeCase()` in parser now strips trailing underscores (e.g. `"__init__"` → `"init"` not `"init_"`)
- Nav param values now URL-encoded in `resolveNav()` — matches API resolver behavior
- Removed dead `paramHints` computation in `extractParams()` — was computed but never used
- `MatchResult` in resolver `No match` test now includes required `candidates: []` field
- `matchWithLLM` correctly imported in matcher tests

### Tests
- 73 tests passing (up from 67)
- Added null param URL tests — API and nav
- Added nav URL encoding test
- Added empty string userId injection test
- Added LLM hallucinated capability ID test
- Added undefined LLM reasoning graceful handling test
  
---

## [0.4.3] — 2026-04-03
### Added
- `CapmanEngine.explain(query)` — explains what would match without executing
  - Returns all candidates with per-candidate human-readable explanations
  - Shows `wouldExecute.action` — what API call or nav would happen
  - Shows `wouldExecute.blocked` — if privacy would prevent execution
  - Fully respects rate limiting and circuit breaker (mirrors `ask()` logic)
- `ExplainResult` and `ExplainCandidate` types exported from public API
- `capman explain "query"` CLI command — shows full explanation in terminal
- LLM rate limiting and circuit breaker in `CapmanEngine`
  - `maxLLMCallsPerMinute` — hard rate limit (default: 60)
  - `llmCooldownMs` — minimum ms between consecutive LLM calls (default: 0)
  - `llmCircuitBreakerThreshold` — failures before circuit opens (default: 3)
  - `llmCircuitBreakerResetMs` — ms before circuit resets (default: 60000)
  - `balanced` and `accurate` modes both respect all limits
  - `explain()` shares the same rate limit state as `ask()`

### Fixed
- `explain()` now mirrors `ask()` matching logic exactly — balanced mode escalates to LLM when confidence < threshold
- `matchWithLLM` internal try-catch removed — errors propagate to engine for proper circuit breaker tracking
- Removed `?? []` on required `candidates` field in trace building
- Removed `?.` on `candidates` in CLI `--debug` block
- Fixed mixed indentation in `ask()` switch statement

---

## [0.4.2] — 2026-02-01
### Added
- `parseOpenAPI(specPathOrUrl)` — parses OpenAPI 3.x and Swagger 2.x specs into capman configs
  - Reads local files or fetches from URL
  - Extracts path params, query params, and request body fields
  - Infers privacy scope from security schemes — bearer → `user_owned`, admin tags → `admin`
  - Generates natural language examples from operation summaries
  - Supports JSON specs; YAML requires `js-yaml` installed
- `capman generate --from <path|url>` — generate manifest from OpenAPI/Swagger spec
- `capman generate --ai` — AI-assisted manifest generation from plain English description
  - Detects `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `OPENROUTER_API_KEY` automatically
  - Validates generated config with Zod before writing
- `ParseResult` type exported from public API
- 9 new parser tests covering all extraction and inference paths

### Fixed
- `bin/capman.js` `generate` command wrapped in async IIFE for proper async support
- OpenAPI duplicate capability IDs resolved automatically with method suffix

---

## [0.4.1] — 2026-03-28
### Fixed
- Prompt injection sanitization in `matchWithLLM` — query now passed as JSON field
- `ask()` now delegates to `CapmanEngine` internally — eliminates logic duplication
- `FileLearningStore` and `MemoryLearningStore` now cap at 10,000 entries with oldest-first pruning
- Post-match cache key now uses `capabilityId + params` instead of raw query — higher hit rate
- Removed duplicate `AskOptions` interface declaration in `index.ts`
- Removed dead imports (`_match`, `_matchWithLLM`, `_resolve`) from `index.ts`
---

## [0.4.0] — 2026-03-xx
### Added
- `CapmanEngine` class — unified entry point with caching, learning, and tracing
- `ExecutionTrace` — structured trace returned with every `engine.ask()` result
- `MatchCandidate[]` — all scored candidates returned, not just the winner
- `capman run "query" --debug` CLI command — shows all candidate scores
- `capman demo` CLI command — live demo with zero config
- Configurable retries and timeout on API resolver
- `MemoryCache`, `FileCache`, `ComboCache` — pluggable cache backends
- `FileLearningStore`, `MemoryLearningStore` — usage analytics and keyword index
- `MatchMode` — `cheap | balanced | accurate` matching modes

### Fixed
- Optional params no longer get garbage fallback values
- `candidates` field made required (was optional `?`)
- Empty query and LLM paths now correctly set `candidates: []`
- `generate()` now deep-copies capabilities — prevents config mutation
- `MemoryCache` now has 512-entry cap with oldest-first eviction
- `fetchWithRetry` converted from recursive to iterative — no stack overflow risk

---

## [0.3.0] — 2026-03-xx
### Added
- `CapmanEngine` initial design with cache and learning stores
- `FileLearningStore` — persists query history and keyword index
- `ComboCache` — memory-first with file fallback
- `scripts/version.js` — prebuild script keeps `src/version.ts` in sync
- Dual ESM/CJS build verification in CI

### Fixed
- Default stores changed to memory-only — no silent filesystem writes
- `FileCache` and `FileLearningStore` converted to async `fs.promises`
- Shared `computeStats()` helper — eliminates code duplication

---

## [0.2.0] — 2026-03-xx
### Added
- Dual CJS + ESM build (`dist/cjs/` and `dist/esm/`)
- `MatchMode` — `cheap | balanced | accurate`
- `AuthContext` — privacy enforcement per capability
- `ApiCallResult` with `status` and `data` fields
- Configurable `retries` and `timeoutMs` on resolver
- `setLogLevel()` exported from public API

### Fixed
- POST/PUT/DELETE requests no longer silently dropped
- `extractParams` now extracts real values from queries
- Stopword filtering in scorer
- Zod runtime validation on config and manifest load
- `files` field in `package.json` — clean npm publish

---

## [0.1.0] — 2026-03-xx
### Added
- Initial release
- CLI: `init`, `generate`, `validate`, `inspect`
- SDK: `match()`, `matchWithLLM()`, `resolve()`, `ask()`
- Two-tier matching: keyword-first, LLM fallback
- Privacy scopes: `public`, `user_owned`, `admin`
- Zod schema validation
- GitHub Actions CI