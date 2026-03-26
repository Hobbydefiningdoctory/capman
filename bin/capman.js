#!/usr/bin/env node
'use strict'

const path = require('path')
const fs   = require('fs')

const args    = process.argv.slice(2)
const command = args[0]
const flags   = args.slice(1)

const getFlag = (name) => {
  const i = flags.indexOf(name)
  return i !== -1 ? flags[i + 1] : undefined
}

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  teal:   '\x1b[36m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  gray:   '\x1b[90m',
}

const log = {
  info:    (...a) => console.log(`${c.teal}i${c.reset}`, ...a),
  success: (...a) => console.log(`${c.green}✓${c.reset}`, ...a),
  warn:    (...a) => console.log(`${c.yellow}⚠${c.reset}`, ...a),
  error:   (...a) => console.error(`${c.red}✗${c.reset}`, ...a),
  blank:   ()     => console.log(),
}

function header() {
  const pkg = require(path.join(__dirname, '..', 'package.json'))
  console.log()
  console.log(`${c.bold}${c.teal}  capman${c.reset} ${c.gray}v${pkg.version} — Capability Manifest Engine${c.reset}`)
  console.log(`${c.gray}  ─────────────────────────────────────────${c.reset}`)
  console.log()
}

function requireSrc() {
  const distPath = path.join(__dirname, '..', 'dist', 'cjs', 'index.js')
  if (fs.existsSync(distPath)) return require(distPath)

  // dist not built — try to build automatically
  log.info('dist/cjs not found — running build...')
  try {
    require('child_process').execSync('npm run build', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    })
    if (fs.existsSync(distPath)) return require(distPath)
  } catch {
    // build failed
  }

  log.error('Cannot find dist/cjs/. Run: pnpm run build')
  process.exit(1)
}

function cmdHelp() {
  header()
  console.log(`${c.bold}  Usage:${c.reset}  node bin/capman.js <command>`)
  console.log()
  console.log(`${c.bold}  Commands:${c.reset}`)
  console.log(`    ${c.teal}init${c.reset}      Create a starter capman.config.js`)
  console.log(`    ${c.teal}generate${c.reset}  Generate manifest.json from config`)
  console.log(`    ${c.teal}validate${c.reset}  Validate an existing manifest.json`)
  console.log(`    ${c.teal}inspect${c.reset}   Print all capabilities in manifest`)
  console.log(`    ${c.teal}demo${c.reset}      Run a live demo with sample queries`)
  console.log(`    ${c.teal}run${c.reset}       Run a query against your manifest`)
  console.log()
  console.log(`${c.bold}  Options:${c.reset}`)
  console.log(`    ${c.gray}--config    Path to config file  (default: capman.config.js)${c.reset}`)
  console.log(`    ${c.gray}--out       Output path          (default: manifest.json)${c.reset}`)
  console.log(`    ${c.gray}--manifest  Manifest to read     (default: manifest.json)${c.reset}`)
  console.log(`    ${c.gray}Options: --debug (show all candidates)${c.reset}`)
  console.log()
}

function cmdInit() {
  header()
  const outPath = path.resolve(process.cwd(), 'capman.config.js')
  if (fs.existsSync(outPath)) {
    log.warn('capman.config.js already exists — not overwriting.')
    process.exit(0)
  }
  const { generateStarterConfig } = requireSrc()
  fs.writeFileSync(outPath, generateStarterConfig())
  log.success(`Created ${c.bold}capman.config.js${c.reset}`)
  log.info(`Edit it with your app's capabilities, then run:`)
  console.log(`\n    node bin/capman.js generate\n`)
}

function cmdGenerate() {
  header()
  const { loadConfig, generate, writeManifest, validate } = requireSrc()

  const configPath = getFlag('--config')
  const outPath    = getFlag('--out') ?? 'manifest.json'

  log.info('Loading config...')
  let config
  try {
    config = loadConfig(configPath)
  } catch (e) {
    log.error(e.message)
    process.exit(1)
  }

  log.info(`Generating manifest for ${c.bold}${config.app}${c.reset}...`)
  const manifest = generate(config)
  const result   = validate(manifest)

  for (const w of result.warnings) log.warn(w)
  for (const e of result.errors)   log.error(e)

  if (!result.valid) {
    log.error('Manifest has errors — fix them before writing.')
    process.exit(1)
  }

  const written = writeManifest(manifest, outPath)
  log.blank()
  log.success(`Manifest written to ${c.bold}${written}${c.reset}`)
  log.info(`${manifest.capabilities.length} capabilities registered`)
  console.log()
}

function cmdValidate() {
  header()
  const { readManifest, validate } = requireSrc()

  const manifestPath = getFlag('--manifest') ?? 'manifest.json'
  let manifest
  try {
    manifest = readManifest(manifestPath)
  } catch (e) {
    log.error(e.message)
    process.exit(1)
  }

  log.info(`Validating ${c.bold}${manifestPath}${c.reset}...`)
  const result = validate(manifest)
  log.blank()

  for (const w of result.warnings) log.warn(w)
  for (const e of result.errors)   log.error(e)

  if (result.valid) {
    log.success(`${manifest.capabilities.length} capabilities — all valid`)
  } else {
    log.error(`${result.errors.length} error(s) found.`)
    process.exit(1)
  }
  console.log()
}

function cmdInspect() {
  header()
  const { readManifest } = requireSrc()

  const manifestPath = getFlag('--manifest') ?? 'manifest.json'
  let manifest
  try {
    manifest = readManifest(manifestPath)
  } catch (e) {
    log.error(e.message)
    process.exit(1)
  }

  console.log(`${c.bold}  App:${c.reset}          ${manifest.app}`)
  console.log(`${c.bold}  Generated:${c.reset}    ${manifest.generatedAt}`)
  console.log(`${c.bold}  Capabilities:${c.reset} ${manifest.capabilities.length}`)
  console.log()

  for (const cap of manifest.capabilities) {
    const col = cap.resolver.type === 'api' ? c.teal : cap.resolver.type === 'nav' ? c.teal : c.yellow
    console.log(`  ${c.bold}${cap.name}${c.reset}  ${col}[${cap.resolver.type}]${c.reset}  ${c.gray}${cap.privacy.level}${c.reset}`)
    console.log(`  ${c.gray}id: ${cap.id}${c.reset}`)
    console.log(`  ${cap.description}`)
    if (cap.examples?.length) {
      console.log(`  ${c.gray}e.g. "${cap.examples[0]}"${c.reset}`)
    }
    console.log()
  }
}

function cmdDemo() {
  header()
  const { generate, match, resolve } = requireSrc()

  console.log(`${c.bold}  Live demo — see capman in action${c.reset}`)
  console.log(`${c.gray}  ─────────────────────────────────────────${c.reset}\n`)

  // Demo manifest — generic e-commerce app
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
          'Do you have size M available?',
          'Product availability for jacket',
          'Is jacket available?',
        ],
        params: [
          { name: 'product', description: 'Product name or ID', required: true, source: 'user_query' }
        ],
        returns: ['stock', 'price', 'variants'],
        resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/products/{product}/availability' }] },
        privacy: { level: 'public' },
      },
      {
        id: 'get_order_status',
        name: 'Get order status',
        description: 'Retrieve the current status and tracking info for an order.',
        examples: [
          'Where is my order?',
          'Track order 1234',
          'What is the status of my recent purchase?',
        ],
        params: [
          { name: 'order_id', description: 'Order ID', required: true, source: 'user_query' }
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
          'Show homepage',
        ],
        params: [
          { name: 'destination', description: 'Target screen', required: true, source: 'user_query' }
        ],
        returns: ['deep_link'],
        resolver: { type: 'nav', destination: '/{destination}' },
        privacy: { level: 'public' },
      },
    ],
  }

  const manifest = generate(config)

  const queries = [
    'Check availability for blue jacket',
    'Track order 1234',
    'Go to cart',
    'Is the website down?',
  ]

  console.log(`${c.gray}  App: ${c.reset}${c.bold}${config.app}${c.reset}`)
  console.log(`${c.gray}  Capabilities: ${c.reset}${manifest.capabilities.length}`)
  console.log(`${c.gray}  Mode: keyword matcher (no LLM required)\n${c.reset}`)

  let passed = 0
  let outOfScope = 0

  for (const query of queries) {
    const start = Date.now()
    const result = match(query, manifest)
    const duration = Date.now() - start

    if (result.capability) {
      passed++
      const resolverColor = result.capability.resolver.type === 'api' ? c.teal :
                            result.capability.resolver.type === 'nav' ? c.teal : c.yellow

      console.log(`  ${c.green}✓${c.reset}  ${c.bold}"${query}"${c.reset}`)
      console.log(`     ${c.gray}→ matched:${c.reset}    ${resolverColor}${result.capability.id}${c.reset}`)
      console.log(`     ${c.gray}→ intent:${c.reset}     ${result.intent}`)
      console.log(`     ${c.gray}→ confidence:${c.reset} ${result.confidence}%`)

      if (Object.keys(result.extractedParams).length > 0) {
        const params = Object.entries(result.extractedParams)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')
        console.log(`     ${c.gray}→ params:${c.reset}     ${params}`)
      }

      // Show what API call would be made
      if (result.capability.resolver.type === 'api') {
        const endpoint = result.capability.resolver.endpoints[0]
        let path = endpoint.path
        for (const [k, v] of Object.entries(result.extractedParams)) {
          if (v) path = path.replace(`{${k}}`, v)
        }
        console.log(`     ${c.gray}→ api call:${c.reset}   ${endpoint.method} ${config.baseUrl}${path}`)
      } else if (result.capability.resolver.type === 'nav') {
        let dest = result.capability.resolver.destination
        for (const [k, v] of Object.entries(result.extractedParams)) {
          if (v) dest = dest.replace(`{${k}}`, v)
        }
        console.log(`     ${c.gray}→ nav target:${c.reset}  ${dest}`)
      }

      console.log(`     ${c.gray}→ time:${c.reset}       ${duration}ms\n`)
    } else {
      outOfScope++
      console.log(`  ${c.yellow}○${c.reset}  ${c.bold}"${query}"${c.reset}`)
      console.log(`     ${c.gray}→ out of scope — no capability handles this\n${c.reset}`)
    }
  }

  console.log(`${c.gray}  ─────────────────────────────────────────${c.reset}`)
  console.log(`  ${c.green}${passed} matched${c.reset}  ${c.gray}·${c.reset}  ${c.yellow}${outOfScope} out of scope${c.reset}  ${c.gray}·${c.reset}  ${manifest.capabilities.length} capabilities\n`)
  console.log(`  ${c.gray}Try it on your own app:${c.reset}`)
  console.log(`  ${c.teal}npx capman init${c.reset}  ${c.gray}→ create your manifest${c.reset}`)
  console.log(`  ${c.teal}npx capman generate${c.reset}  ${c.gray}→ generate manifest.json${c.reset}\n`)
}

function cmdRun() {
  header()
  const query = args[1]
  const debug = flags.includes('--debug')
  const manifestPath = getFlag('--manifest') ?? 'manifest.json'

  if (!query) {
    log.error('Please provide a query. Example: node bin/capman.js run "show me articles"')
    process.exit(1)
  }

  const { readManifest, match } = requireSrc()

  let manifest
  try {
    manifest = readManifest(manifestPath)
  } catch (e) {
    log.error(e.message)
    process.exit(1)
  }

  log.info(`Query: "${query}"`)
  log.blank()

  const result = match(query, manifest)

  if (result.capability) {
    console.log(`  ${c.green}✓${c.reset}  Matched: ${c.bold}${result.capability.id}${c.reset}`)
    console.log(`     Intent:     ${result.intent}`)
    console.log(`     Confidence: ${result.confidence}%`)
    console.log(`     Resolver:   ${result.capability.resolver.type}`)

    if (Object.keys(result.extractedParams).length > 0) {
      const params = Object.entries(result.extractedParams)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')
      console.log(`     Params:     ${params}`)
    }

    if (debug && result.candidates?.length) {
      log.blank()
      console.log(`  ${c.gray}── All candidates:${c.reset}`)
      result.candidates
        .sort((a, b) => b.score - a.score)
        .forEach(c2 => {
          const marker = c2.matched ? c.green + '✓' : c.gray + '○'
          console.log(`     ${marker}${c.reset}  ${c2.capabilityId}: ${c2.score}%`)
        })
    }
  } else {
    console.log(`  ${c.yellow}○${c.reset}  OUT_OF_SCOPE — no capability matched`)
    console.log(`     ${c.gray}${result.reasoning}${c.reset}`)

    if (debug && result.candidates?.length) {
      log.blank()
      console.log(`  ${c.gray}── All candidates:${c.reset}`)
      result.candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .forEach(c2 => {
          console.log(`     ${c.gray}○  ${c2.capabilityId}: ${c2.score}%${c.reset}`)
        })
    }
  }
  console.log()
}

switch (command) {
  case 'init':     cmdInit();     break
  case 'generate': cmdGenerate(); break
  case 'validate': cmdValidate(); break
  case 'inspect':  cmdInspect();  break
  case 'demo':     cmdDemo();     break
  case 'run':      cmdRun();      break
  case undefined:
  case '--help':
  case '-h':       cmdHelp();     break
  default:
    header()
    log.error(`Unknown command: ${command}`)
    console.log(`  Run: node bin/capman.js --help\n`)
    process.exit(1)
}