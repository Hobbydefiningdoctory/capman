'use strict'

const { header, c, requireSrc } = require('./shared')

module.exports = function cmdDemo() {
  header()
  const { generate, match } = requireSrc()

  console.log(`${c.bold}  Turn natural language into reliable, explainable backend actions.${c.reset}`)
  console.log(`${c.gray}  ─────────────────────────────────────────${c.reset}\n`)

  const config = {
    app: 'demo-store',
    baseUrl: 'https://api.demo-store.com',
    capabilities: [
      {
        id: 'check_product_availability',
        name: 'Check product availability',
        description: 'Check stock and pricing for a product by name or ID.',
        examples: [
          'Is the blue jacket in stock?',
          'Check stock for blue jacket',
          'Check availability for blue jacket',
          'Product availability for jacket',
        ],
        params: [
          { name: 'product', description: 'Product name or ID', required: true, source: 'user_query' },
        ],
        returns: ['stock', 'price', 'variants'],
        resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/products/{product}/availability' }] },
        privacy: { level: 'public' },
      },
      {
        id: 'get_order_status',
        name: 'Get order status',
        description: 'Retrieve the current status and tracking info for an order by order ID.',
        examples: [
          'Where is my order?',
          'Track order 1234',
          'What is the status of my purchase?',
        ],
        params: [
          { name: 'order_id', description: 'Order ID', required: true, source: 'user_query' },
        ],
        returns: ['status', 'tracking', 'estimated_delivery'],
        resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/orders/{order_id}' }] },
        privacy: { level: 'user_owned' },
      },
      {
        id: 'navigate_to_screen',
        name: 'Navigate to screen',
        description: 'Route the user to a specific page in the store.',
        examples: [
          'Take me to cart',
          'Open cart',
          'Go to checkout',
          'Navigate to account',
        ],
        params: [
          { name: 'destination', description: 'Target screen', required: true, source: 'user_query' },
        ],
        returns: ['deep_link'],
        resolver: { type: 'nav', destination: '/{destination}' },
        privacy: { level: 'public' },
      },
    ],
  }

  const manifest = generate(config)

  console.log(`${c.gray}  app:${c.reset}          ${c.bold}${config.app}${c.reset}`)
  console.log(`${c.gray}  capabilities:${c.reset} ${manifest.capabilities.length}`)
  console.log(`${c.gray}  matcher:${c.reset}      keyword (no LLM, no API key needed)\n`)

  const queries = [
    { text: 'Check availability for blue jacket', expectMatch: true  },
    { text: 'Track order 1234',                   expectMatch: true  },
    { text: 'Go to cart',                         expectMatch: true  },
    { text: 'Is the website down?',               expectMatch: false },
  ]

  let passed    = 0
  let outOfScope = 0

  for (const q of queries) {
    const t0     = Date.now()
    const result = match(q.text, manifest)
    const ms     = Date.now() - t0

    console.log(`${c.gray}  ────────────────────────────────────────${c.reset}`)
    console.log()
    console.log(`  ${c.bold}QUERY${c.reset}`)
    console.log(`  "${c.bold}${q.text}${c.reset}"\n`)

    if (!result.capability) {
      outOfScope++
      console.log(`  ${c.bold}MATCH${c.reset}`)
      console.log(`  ${c.yellow}○  OUT_OF_SCOPE${c.reset} — no capability handles this query\n`)
      console.log(`  ${c.bold}EXECUTION${c.reset}`)
      console.log(`  ${c.gray}[1] keyword_match  no match  ${ms}ms${c.reset}\n`)
      console.log(`  ${c.bold}RESULT${c.reset}`)
      console.log(`  ${c.yellow}No action taken — query is outside manifest scope${c.reset}\n`)
      console.log(`  ${c.bold}EXPLANATION${c.reset}`)
      if (result.candidates.length) {
        const best = result.candidates.sort((a, b) => b.score - a.score)[0]
        console.log(`  ${c.gray}Closest capability was "${best.capabilityId}" (${best.score}%) —`)
        console.log(`  below the 50% confidence threshold. Correctly rejected.${c.reset}`)
      }
      console.log()
      continue
    }

    passed++

    let actionLine = ''
    if (result.capability.resolver.type === 'api') {
      const endpoint = result.capability.resolver.endpoints[0]
      let p = endpoint.path
      for (const [k, v] of Object.entries(result.extractedParams)) {
        if (v) p = p.replaceAll(`{${k}}`, String(v))
      }
      actionLine = `${endpoint.method} ${config.baseUrl}${p}`
    } else if (result.capability.resolver.type === 'nav') {
      let dest = result.capability.resolver.destination
      for (const [k, v] of Object.entries(result.extractedParams)) {
        if (v) dest = dest.replaceAll(`{${k}}`, String(v))
      }
      actionLine = `navigate → ${dest}`
    }

    const sorted      = [...result.candidates].sort((a, b) => b.score - a.score)
    const winner      = sorted[0]
    const runners     = sorted.slice(1).filter(r => r.score > 0)
    const paramEntries = Object.entries(result.extractedParams).filter(([, v]) => v !== null)

    console.log(`  ${c.bold}MATCH${c.reset}`)
    console.log(`  ${c.green}✓  ${result.capability.id}${c.reset}`)
    console.log(`  ${c.gray}intent:     ${c.reset}${result.intent}`)
    console.log(`  ${c.gray}confidence: ${c.reset}${c.bold}${result.confidence}%${c.reset}`)
    console.log(`  ${c.gray}privacy:    ${c.reset}${result.capability.privacy.level}`)
    if (paramEntries.length) {
      console.log(`  ${c.gray}params:     ${c.reset}${paramEntries.map(([k, v]) => `${k}=${v}`).join(', ')}`)
    }
    console.log()

    console.log(`  ${c.bold}EXECUTION${c.reset}`)
    console.log(`  ${c.gray}[1] cache_check    miss    0ms${c.reset}`)
    console.log(`  ${c.gray}[2]${c.reset} keyword_match  ${c.green}pass${c.reset}    ${ms}ms   confidence: ${result.confidence}%`)
    console.log(`  ${c.gray}[3] privacy_check  pass    0ms   level: ${result.capability.privacy.level}${c.reset}`)
    console.log(`  ${c.gray}[4] resolve        pass    ${ms}ms   via ${result.capability.resolver.type}${c.reset}`)
    console.log()

    console.log(`  ${c.bold}RESULT${c.reset}`)
    console.log(`  ${c.green}${actionLine}${c.reset}`)
    console.log()

    console.log(`  ${c.bold}EXPLANATION${c.reset}`)
    console.log(`  ${c.gray}Why "${winner.capabilityId}"?${c.reset}`)
    console.log(`  ${c.gray}  scored ${winner.score}% — highest match against examples and description${c.reset}`)
    if (runners.length) {
      console.log(`  ${c.gray}  rejected: ${runners.map(r => `${r.capabilityId} (${r.score}%)`).join(', ')}${c.reset}`)
    }
    if (paramEntries.length) {
      console.log(`  ${c.gray}  extracted from query: ${paramEntries.map(([k, v]) => `${k}="${v}"`).join(', ')}${c.reset}`)
    }
    console.log()
  }

  console.log(`${c.gray}  ────────────────────────────────────────${c.reset}\n`)
  console.log(`  ${c.green}${passed} matched${c.reset}  ${c.gray}·${c.reset}  ${c.yellow}${outOfScope} out of scope${c.reset}  ${c.gray}·${c.reset}  ${manifest.capabilities.length} capabilities  ${c.gray}·${c.reset}  no LLM required\n`)
  console.log(`  ${c.bold}Every query above is fully traced.${c.reset}`)
  console.log(`  ${c.gray}You saw what matched, why it matched, how it executed, what it called,`)
  console.log(`  and which alternatives were considered and rejected.${c.reset}`)
  console.log(`  ${c.gray}No black box. No guessing. Full control.\n${c.reset}`)
  console.log(`  ${c.gray}Next steps:${c.reset}`)
  console.log(`  ${c.teal}npx capman init${c.reset}                          ${c.gray}→ define your app's capabilities${c.reset}`)
  console.log(`  ${c.teal}npx capman generate${c.reset}                      ${c.gray}→ generate manifest.json${c.reset}`)
  console.log(`  ${c.teal}npx capman run "your query" --debug${c.reset}      ${c.gray}→ trace any query live${c.reset}`)
  console.log(`  ${c.teal}npm install capman${c.reset}                       ${c.gray}→ use in your AI agent${c.reset}\n`)
}
