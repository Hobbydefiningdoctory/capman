import type { Capability, Manifest, MatchResult } from './types'

function scoreCapability(query: string, cap: Capability): number {
  const q = query.toLowerCase()
  let score = 0

  for (const example of cap.examples ?? []) {
    const exWords = example.toLowerCase().split(/\s+/)
    const qWords  = q.split(/\s+/)
    const overlap = exWords.filter(w => qWords.includes(w)).length
    score += (overlap / exWords.length) * 60
  }

  const descWords   = cap.description.toLowerCase().split(/\W+/).filter(Boolean)
  const qWords      = q.split(/\W+/).filter(Boolean)
  const descOverlap = descWords.filter(w => qWords.includes(w)).length
  score += (descOverlap / Math.max(descWords.length, 1)) * 30

  const nameWords   = cap.name.toLowerCase().split(/\W+/).filter(Boolean)
  const nameOverlap = nameWords.filter(w => qWords.includes(w)).length
  score += (nameOverlap / Math.max(nameWords.length, 1)) * 10

  return Math.min(Math.round(score), 100)
}

function resolverToIntent(cap: Capability): MatchResult['intent'] {
  const t = cap.resolver.type
  if (t === 'api')    return 'retrieval'
  if (t === 'nav')    return 'navigation'
  if (t === 'hybrid') return 'hybrid'
  return 'out_of_scope'
}

function extractParams(query: string, cap: Capability): Record<string, string | null> {
  const result: Record<string, string | null> = {}
  const q = query.toLowerCase()

  for (const param of cap.params) {
    // Session params come from auth context, not query
    if (param.source === 'session') {
      result[param.name] = '[from_session]'
      continue
    }

    if (param.source !== 'user_query') {
      result[param.name] = null
      continue
    }

    // Try to extract value after known keywords
    // e.g. "profile for johndoe" → johndoe
    //      "articles by jane"   → jane
    //      "tag javascript"     → javascript
    const keywords = [
      `for `, `by `, `about `, `named `, `called `,
      `tag `, `user `, `author `, `slug `, `id `,
      `to `, `from `, `with `,
    ]

    let extracted: string | null = null

    for (const kw of keywords) {
      const idx = q.indexOf(kw)
      if (idx !== -1) {
        const after = query.slice(idx + kw.length).trim()
        const token = after.split(/\s+/)[0]
        if (token && token.length > 1) {
          extracted = token.replace(/[^a-zA-Z0-9-_@.]/g, '')
          break
        }
      }
    }

    // Fallback — grab last meaningful word in the query
    if (!extracted) {
      const words = query.trim().split(/\s+/)
      const stopwords = new Set([
        'show', 'me', 'the', 'get', 'find', 'fetch', 'give',
        'what', 'is', 'are', 'a', 'an', 'my', 'i', 'want',
        'to', 'please', 'can', 'you', 'open', 'take', 'go',
      ])
      const meaningful = words.filter(w => !stopwords.has(w.toLowerCase()))
      extracted = meaningful[meaningful.length - 1] ?? null
    }

    result[param.name] = extracted
  }

  return result
}

export function match(query: string, manifest: Manifest): MatchResult {
  if (!query?.trim()) {
    return {
      capability: null,
      confidence: 0,
      intent: 'out_of_scope',
      extractedParams: {},
      reasoning: 'Empty query',
    }
  }

  let best: Capability | null = null
  let bestScore = 0

  for (const cap of manifest.capabilities) {
    const score = scoreCapability(query, cap)
    if (score > bestScore) {
      bestScore = score
      best = cap
    }
  }

  if (!best || bestScore < 50) {
    return {
      capability: null,
      confidence: bestScore,
      intent: 'out_of_scope',
      extractedParams: {},
      reasoning: `No capability matched with sufficient confidence (best score: ${bestScore})`,
    }
  }

  return {
    capability: best,
    confidence: bestScore,
    intent: resolverToIntent(best),
    extractedParams: extractParams(query, best),
    reasoning: `Matched "${best.id}" via keyword scoring (score: ${bestScore})`,
  }
}

export interface LLMMatcherOptions {
  llm: (prompt: string) => Promise<string>
}

export async function matchWithLLM(
  query: string,
  manifest: Manifest,
  options: LLMMatcherOptions
): Promise<MatchResult> {
  const manifestSummary = manifest.capabilities.map(c =>
    `- ${c.id} (${c.resolver.type}): ${c.description}${
      c.examples?.length ? `\n  examples: ${c.examples.slice(0, 2).join(', ')}` : ''
    }`
  ).join('\n')

  const prompt = `You are an intent matcher for an AI agent system.

App: ${manifest.app}

Available capabilities:
${manifestSummary}

User query: "${query}"

Respond ONLY in valid JSON (no markdown):
{
  "matched_capability": "<capability_id or OUT_OF_SCOPE>",
  "confidence": <0-100>,
  "intent": "<navigation|retrieval|hybrid|out_of_scope>",
  "reasoning": "<one sentence>",
  "extracted_params": { "<param_name>": "<value or null>" }
}`

  try {
    const raw   = await options.llm(prompt)
    const clean = raw.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)

    const isOOS    = parsed.matched_capability === 'OUT_OF_SCOPE'
    const capability = isOOS
      ? null
      : manifest.capabilities.find(c => c.id === parsed.matched_capability) ?? null

    return {
      capability,
      confidence: parsed.confidence,
      intent: isOOS ? 'out_of_scope' : parsed.intent,
      extractedParams: parsed.extracted_params ?? {},
      reasoning: parsed.reasoning,
    }
  } catch (err) {
    console.warn('[capman] LLM match failed, falling back to keyword matcher:', err)
    return match(query, manifest)
  }
}