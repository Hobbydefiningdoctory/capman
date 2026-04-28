'use strict'

const { header, log, c, args, posArgs, getFlag, requireSrc } = require('./shared')

module.exports = async function cmdExplain() {
  header()
  const query = posArgs[0] ?? args[1]
  const manifestPath = getFlag('--manifest') ?? 'manifest.json'

  if (!query) {
    log.error('Please provide a query.')
    console.log(`  Example: npx capman explain "show me articles"\n`)
    process.exit(1)
  }

  const { readManifest, CapmanEngine } = requireSrc()

  let manifest
  try {
    manifest = readManifest(manifestPath)
  } catch (e) {
    log.error(e.message)
    process.exit(1)
  }

  const engine = new CapmanEngine({ manifest, cache: false, learning: false, mode: 'cheap' })
  const result = await engine.explain(query)

  console.log(`\n  ${c.bold}QUERY${c.reset}`)
  console.log(`  "${c.bold}${query}${c.reset}"\n`)

  // ── Match ────────────────────────────────────────────────────────────────
  console.log(`  ${c.bold}MATCH${c.reset}`)
  if (result.matched.capability) {
    console.log(`  ${c.green}✓  ${result.matched.capability.id}${c.reset}`)
    console.log(`  ${c.gray}confidence:${c.reset} ${result.matched.confidence}%`)
    console.log(`  ${c.gray}intent:${c.reset}     ${result.matched.intent}`)
  } else {
    console.log(`  ${c.yellow}○  OUT_OF_SCOPE${c.reset} — no capability matched\n`)
  }
  console.log()

  // ── Reasoning ────────────────────────────────────────────────────────────
  console.log(`  ${c.bold}REASONING${c.reset}`)
  result.matched.reasoning.forEach(r => {
    console.log(`  ${c.gray}•${c.reset} ${r}`)
  })
  console.log()

  // ── All candidates ────────────────────────────────────────────────────────
  console.log(`  ${c.bold}ALL CANDIDATES${c.reset}`)
  result.candidates.forEach(cand => {
    const marker     = cand.matched ? `${c.green}✓${c.reset}` : `${c.gray}○${c.reset}`
    const scoreColor = cand.score >= 50 ? c.green : c.gray
    console.log(`  ${marker}  ${cand.capabilityId}`)
    console.log(`     ${scoreColor}${cand.score}%${c.reset}  ${c.gray}${cand.explanation}${c.reset}`)
  })
  console.log()

  // ── Would execute ─────────────────────────────────────────────────────────
  console.log(`  ${c.bold}WOULD EXECUTE${c.reset}`)
  if (result.wouldExecute.blocked) {
    console.log(`  ${c.yellow}✗  Blocked — ${result.wouldExecute.blocked}${c.reset}`)
  } else if (result.wouldExecute.action) {
    console.log(`  ${c.green}✓  ${result.wouldExecute.action}${c.reset}`)
    console.log(`  ${c.gray}privacy: ${result.wouldExecute.privacy}${c.reset}`)
  } else {
    console.log(`  ${c.yellow}○  No action — query is out of scope${c.reset}`)
  }
  console.log()
  console.log(`  ${c.gray}${result.durationMs}ms  ·  via ${result.resolvedVia}${c.reset}\n`)
}
