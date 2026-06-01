---
name: Matching bugs and fixes
description: 8 root-cause fixes across matcher/parser/generator — intent classification, camelCase tokenization, ceiling calibration, deprecated detection, HTML stripping
---

## Fixes applied

### matcher.ts
- **resolverToIntent**: was hardcoded `return 'retrieval'` for all api resolvers. Now reads `endpoints[0].method`; GET/HEAD → `retrieval`, all else → `action`.
- **tokenize**: add `.replace(/([a-z])([A-Z])/g, '$1 $2')` BEFORE `.toLowerCase()`. Without this "PaymentIntent" → one opaque token that never matches two-word queries.
- **calibrateCeiling**: was calibrating from 2-4 word examples → real queries exceed ceiling → clamped 100% everywhere. Now calibrates from `name + description` (longer, representative).
- **Deprecated score penalty**: `depPenalty = cap.lifecycle?.status === 'deprecated' ? 0.3 : 1` applied to keywordScore. Keeps deprecated discoverable but ranked last.
- **LLM prompt**: added `action` to intent enum string: `"<navigation|retrieval|action|hybrid|out_of_scope>"`.

**Why:** `MatchResult.intent` type in `types.ts` must also include `'action'` (already done).

### parser.ts (convertOperation + generateExamples)
- **HTML stripping**: `stripHTML()` applied to `rawDescription` and `rawName` before any processing. Enterprise specs (Stripe) embed HTML — raw tags poison BM25 and prevent deprecation detection. Tag regex: `/<[^>]*>?/g` (the `?` catches truncated tags with no closing `>`).
- **Deprecation detection**: `DEPRECATION_RE` checks cleaned rawDescription. If matched: description synthesized from path shape, name cleaned, `lifecycle: { status: 'deprecated' }` set.
- **generateExamples**: now takes `method` and `urlPath` params. GET + trailing `{param}` → "retrieve X", "fetch X by id". GET + collection → "list all X", "search X". POST → "create X", "add new X". PUT/PATCH → "update X", "edit X". DELETE → "delete X", "remove X". Deduplicates, caps at 5.

### generator.ts (sanitizeCap)
- **HTML stripping + deprecated detection at generate time**: same `stripHTML` + `DEPRECATION_RE` logic applied in `sanitizeCap()` so pre-baked configs (generated before the parser fix) are also cleaned on every `generate` run — no re-parse needed.
- **`idToHumanName(id)`**: `id.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())` — used when the capability name IS the deprecation notice.

## Key constraint
`<[^>]*>?/g` (not `<[^>]*>/g`) — the `?` on `>` is required to strip truncated HTML tags like `<a href="https://dash` that appear when a previous generate run ran `truncate()` on mid-tag text. Without `?` those 7 examples remain HTML-polluted.

## Test coverage added
- `tokenize splits camelCase` — `'PaymentIntent'` → contains `'payment'` and `'intent'`, not `'paymentintent'`
- `GET api resolver → retrieval`, `POST/DELETE api resolver → action`
- `deprecated capability scores lower than active equivalent`
- `marks deprecated endpoints with lifecycle.status = deprecated` (parser integration test)
- `GET-list and GET-by-id generate different synonym examples` (parser integration test)
