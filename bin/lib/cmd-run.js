'use strict'

const { header, log, c, args, posArgs, flags, getFlag, requireSrc } = require('./shared')

module.exports = function cmdRun() {
  header()
  const query = posArgs[0] ?? args[1]
  const debug = flags.includes('--debug')
  const manifestPath = getFlag('--manifest') ?? 'manifest.json'

  if (!query) {
    log.error('Please provide a query.')
    console.log(`  Example: npx capman run "show me articles"\n`)
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

    if (debug && result.candidates.length) {
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

    if (debug && result.candidates.length) {
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
