import { generate, match, validate } from '../src/index'

// Load the conduit config manually
const config = require('../conduit.config.js')

// Generate manifest
const manifest = generate(config)

// Validate it first
const validation = validate(manifest)
if (!validation.valid) {
  console.error('Manifest errors:', validation.errors)
  process.exit(1)
}

console.log(`\n✓ Manifest valid — ${manifest.capabilities.length} capabilities\n`)
console.log('─'.repeat(60))

// Real world queries — messy, vague, edge cases
const queries = [
  // Clear matches
  'Show me the latest articles',
  'What tags are popular?',
  'Get profile for johndoe',
  'My personal feed',
  'Take me to article how-to-train-your-dragon',
  'Show article and comments for introduction-to-react',

  // Vague but should match
  'What is everyone writing about?',
  'I want to read something',
  'Who is techwriter42?',
  'Where can I see my followed authors posts?',

  // Slightly ambiguous
  'Show me johndoe',
  'Open introduction-to-react',
  'Give me articles about javascript',
  'Go to sam',

  // Should be out of scope
  'Is the server down?',
  'Delete my account',
  'What is the weather today?',
  'Send an email to john',
]

let matched    = 0
let outOfScope = 0

for (const query of queries) {
  const result = match(query, manifest)

  const status = result.capability ? '✓' : '○'
  const name   = result.capability ? result.capability.id : 'OUT_OF_SCOPE'
  const conf   = result.confidence

  console.log(`\n  ${status}  "${query}"`)
  console.log(`     → ${name}  (${conf}%)`)

  if (result.capability) matched++
  else outOfScope++
}

console.log('\n' + '─'.repeat(60))
console.log(`\n  Total queries:   ${queries.length}`)
console.log(`  Matched:         ${matched}`)
console.log(`  Out of scope:    ${outOfScope}`)
console.log()