import 'dotenv/config'
import { generate, matchWithLLM } from '../src/index'
import { CapmanEngine } from '../src/engine'
import type { CapmanConfig } from '../src/types'

// ── Config ────────────────────────────────────────────────────────────────────

const config: CapmanConfig = {
  app: 'conduit',
  baseUrl: 'https://conduit.productionready.io/api',
  capabilities: [
    {
      id: 'get_global_articles',
      name: 'Get global articles',
      description: 'Fetch a list of all articles from the global feed.',
      examples: ['Show me the latest articles', 'Get all articles', 'List recent posts'],
      params: [
        { name: 'tag', description: 'Filter by tag', required: false, source: 'user_query' },
      ],
      returns: ['articles'],
      resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/articles' }] },
      privacy: { level: 'public' },
    },
    {
      id: 'get_user_profile',
      name: 'Get user profile',
      description: 'Fetch the public profile of a user by their username.',
      examples: ['Show profile for johndoe', 'Who is techwriter42?'],
      params: [
        { name: 'username', description: 'Username to look up', required: true, source: 'user_query' },
      ],
      returns: ['profile'],
      resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/profiles/{username}' }] },
      privacy: { level: 'public' },
    },
    {
      id: 'get_personal_feed',
      name: 'Get personal feed',
      description: 'Fetch articles from authors the current user follows.',
      examples: ['My feed', 'Articles from people I follow'],
      params: [],
      returns: ['articles'],
      resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/articles/feed' }] },
      privacy: { level: 'user_owned' },
    },
    {
      id: 'navigate_to_article',
      name: 'Navigate to article',
      description: 'Route the user to a specific article page.',
      examples: ['Take me to article how-to-train-your-dragon', 'Open article intro-to-react'],
      params: [
        { name: 'slug', description: 'Article slug', required: true, source: 'user_query' },
      ],
      returns: ['deep_link'],
      resolver: { type: 'nav', destination: '/#/article/{slug}' },
      privacy: { level: 'public' },
    },
  ],
}

const manifest = generate(config)

// ── OpenRouter LLM function ───────────────────────────────────────────────────

const MODEL = 'openai/gpt-oss-120b:free'

async function llm(prompt: string): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://github.com/Hobbydefiningdoctory/capman',
      'X-Title': 'capman',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
      provider: {
        order: ['open-inference'],
        allow_fallbacks: true,
      },
    }),
  })

  const data = await res.json() as any
  console.log(`  [DEBUG] status: ${res.status} | model: ${data.model ?? 'unknown'}`)

  if (!res.ok) {
    console.log('  [DEBUG] error:', JSON.stringify(data.error))
    throw new Error(`OpenRouter ${res.status}: ${data.error?.message}`)
  }

  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('Empty response from LLM')
  return content
}

// ── Test queries ──────────────────────────────────────────────────────────────

const queries = [
  'What is everyone writing about?',
  'I want to read something interesting',
  'Who is techwriter42?',
  'Show me johndoe',
  'Take me to article how-to-train-your-dragon',
  'My personal feed',
  'Is the server down?',
  'Send an email to john',
]

async function run() {
  console.log('\n✓ Manifest ready —', manifest.capabilities.length, 'capabilities')
  console.log('  Model:', MODEL)
  console.log('  Key:', process.env.OPENROUTER_API_KEY ? '✓ set' : '✗ missing')
  console.log('\n' + '─'.repeat(60))
  console.log('\n── LLM matching:\n')

  let matched = 0
  let outOfScope = 0

  for (const query of queries) {
    try {
      const result = await matchWithLLM(query, manifest, { llm })
      const status = result.capability ? '✓' : '○'
      const name   = result.capability?.id ?? 'OUT_OF_SCOPE'
      if (result.capability) matched++
      else outOfScope++

      console.log(`  ${status}  "${query}"`)
      console.log(`     → ${name} (${result.confidence}%)`)
      console.log(`     → ${result.reasoning}`)
      if (result.extractedParams && Object.keys(result.extractedParams).length) {
        console.log(`     → params: ${JSON.stringify(result.extractedParams)}`)
      }
      console.log()
    } catch (err) {
      console.log(`  ✗  "${query}" — ERROR: ${err}`)
      console.log()
    }
  }

  console.log('─'.repeat(60))
  console.log(`\n  Matched: ${matched} | Out of scope: ${outOfScope} | Total: ${queries.length}\n`)

  // CapmanEngine accurate mode test
  console.log('── CapmanEngine (accurate mode):\n')
  try {
    const engine = new CapmanEngine({
      manifest,
      mode: 'accurate',
      llm,
      cache: false,
      learning: false,
    })

    const result = await engine.ask('What is everyone writing about today?', { dryRun: true })
    console.log('  Query:       "What is everyone writing about today?"')
    console.log('  Matched:     ', result.match.capability?.id ?? 'OUT_OF_SCOPE')
    console.log('  Confidence:  ', result.match.confidence + '%')
    console.log('  Resolved via:', result.resolvedVia)
    console.log('  Reasoning:   ', result.trace.reasoning)
    console.log('  Steps:       ', result.trace.steps.map(s => `${s.type}(${s.status})`).join(' → '))
  } catch (err) {
    console.log('  ✗ Engine test failed:', err)
  }
  console.log()
}

run().catch(console.error)