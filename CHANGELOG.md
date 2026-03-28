# Changelog

All notable changes to capman are documented here.

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