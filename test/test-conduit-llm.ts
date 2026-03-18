import { generate, matchWithLLM, validate } from '../src/index'

require('dotenv').config()

const config = require('./conduit.config.js')
const manifest = generate(config)

const validation = validate(manifest)
if (!validation.valid) {
  console.error('Manifest errors:', validation.errors)
  process.exit(1)
}

// Prefer Replit AI integration, fall back to DeepSeek if configured
const replitBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
const replitApiKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY
const deepseekKey   = process.env.DEEPSEEK_API_KEY

const useReplit = !!(replitBaseUrl && replitApiKey)
const provider  = useReplit ? 'Replit AI (gpt-4o-mini)' : 'DeepSeek (deepseek-chat)'

if (!useReplit && !deepseekKey) {
  console.error('No LLM provider configured. Set AI_INTEGRATIONS_OPENAI_BASE_URL or DEEPSEEK_API_KEY.')
  process.exit(1)
}

console.log(`\n✓ Manifest valid — ${manifest.capabilities.length} capabilities`)
console.log(`  Provider: ${provider}\n`)
console.log('─'.repeat(60))

async function llm(prompt: string): Promise<string> {
  const url     = useReplit ? `${replitBaseUrl}/chat/completions` : 'https://api.deepseek.com/chat/completions'
  const key     = useReplit ? replitApiKey! : deepseekKey!
  const model   = useReplit ? 'gpt-4o-mini' : 'deepseek-chat'

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`LLM API error ${res.status}: ${err}`)
  }

  const data = await res.json() as { choices: { message: { content: string } }[] }
  return data.choices[0].message.content
}

const vagueQueries = [
  // Vague — LLM should resolve these
  'What is everyone writing about?',
  'I want to read something',
  'Who is techwriter42?',
  'Show me johndoe',
  'Open introduction-to-react',

  // Clearly out of scope — LLM should reject these
  'Is the server down?',
  'Delete my account',
  'What is the weather today?',
  'Send an email to john',
]

async function run() {
  let matched    = 0
  let outOfScope = 0

  for (const query of vagueQueries) {
    const result = await matchWithLLM(query, manifest, { llm })

    const status = result.capability ? '✓' : '○'
    const name   = result.capability ? result.capability.id : 'OUT_OF_SCOPE'

    console.log(`\n  ${status}  "${query}"`)
    console.log(`     → ${name}  (${result.confidence}%)`)
    console.log(`     ${result.reasoning}`)

    if (result.capability) matched++
    else outOfScope++
  }

  console.log('\n' + '─'.repeat(60))
  console.log(`\n  Total:        ${vagueQueries.length}`)
  console.log(`  Matched:      ${matched}`)
  console.log(`  Out of scope: ${outOfScope}`)
  console.log()
}

run().catch(console.error)
