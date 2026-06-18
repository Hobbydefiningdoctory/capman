'use strict'

const fs = require('fs')
const path = require('path')
const { header, log, c, flags, getFlag, requireSrc } = require('./shared')

module.exports = async function cmdTest() {
  const jsonMode     = flags.includes('--json')
  const manifestPath = getFlag('--manifest') ?? 'manifest.json'
  const modeFlag      = getFlag('--mode') ?? 'cheap'
  const casesPath     = getFlag('--cases')

  if (!jsonMode) header()

  if (!casesPath) {
    log.error('Please provide a test cases file with --cases <path>')
    console.log(`  Example: npx capman test --cases queries.json\n`)
    console.log(`  queries.json format:`)
    console.log(`  [`)
    console.log(`    { "query": "show order 1234", "expected": "get_order_status" },`)
    console.log(`    { "query": "go to cart",       "expected": "navigate_to_screen" }`)
    console.log(`  ]\n`)
    process.exit(1)
  }

  let cases
  try {
    const raw = fs.readFileSync(path.resolve(casesPath), 'utf-8')
    cases = JSON.parse(raw)
  } catch (e) {
    log.error(`Could not read or parse ${casesPath}: ${e.message}`)
    process.exit(1)
  }

  if (!Array.isArray(cases) || cases.length === 0) {
    log.error(`${casesPath} must contain a non-empty JSON array of { query, expected } objects`)
    process.exit(1)
  }

  for (const [i, tc] of cases.entries()) {
    if (typeof tc.query !== 'string' || typeof tc.expected !== 'string') {
      log.error(`Case ${i} is malformed — each entry needs string "query" and "expected" fields`)
      process.exit(1)
    }
  }

  const { readManifest, CapmanEngine } = requireSrc()

  let manifest
  try {
    manifest = readManifest(manifestPath)
  } catch (e) {
    log.error(e.message)
    process.exit(1)
  }

  const engine = new CapmanEngine({ manifest, cache: false, learning: false, mode: modeFlag })

  const results = []
  for (const tc of cases) {
    const result = await engine.ask(tc.query, { dryRun: true })
    const actual = result.match.capability?.id ?? null
    // 'out_of_scope' as expected value matches a null capability
    const expectedNorm = tc.expected === 'out_of_scope' ? null : tc.expected
    const pass = actual === expectedNorm
    results.push({
      query:      tc.query,
      expected:   tc.expected,
      actual:     actual ?? 'out_of_scope',
      confidence: result.match.confidence,
      verdict:    result.verdict,
      pass,
    })
  }

  const passed = results.filter(r => r.pass).length
  const failed = results.length - passed

  if (jsonMode) {
    console.log(JSON.stringify({ total: results.length, passed, failed, results }, null, 2))
    if (failed > 0) process.exit(1)
    return
  }

  log.info(`Running ${results.length} test case(s) against ${c.bold}${manifestPath}${c.reset} (mode: ${modeFlag})`)
  log.blank()

  for (const r of results) {
    const marker = r.pass ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`
    console.log(`  ${marker}  "${r.query}"`)
    if (r.pass) {
      console.log(`     ${c.gray}→ ${r.actual} (${r.confidence}%, ${r.verdict})${c.reset}`)
    } else {
      console.log(`     ${c.gray}expected:${c.reset} ${r.expected}`)
      console.log(`     ${c.red}actual:${c.reset}   ${r.actual} (${r.confidence}%, ${r.verdict})`)
    }
  }

  console.log()
  if (failed === 0) {
    log.success(`${passed}/${results.length} passed`)
  } else {
    log.error(`${failed}/${results.length} failed (${passed} passed)`)
    process.exit(1)
  }
  console.log()
}