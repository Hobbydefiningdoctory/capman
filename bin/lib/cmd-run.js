'use strict'

const { header, log, c, args, posArgs, flags, getFlag, requireSrc } = require('./shared')

module.exports = async function cmdRun() {
  header()
  const query        = posArgs[0] ?? args[1]
  const debug        = flags.includes('--debug')
  const jsonMode     = flags.includes('--json')
  const manifestPath = getFlag('--manifest') ?? 'manifest.json'
  const modeFlag     = getFlag('--mode') ?? 'cheap'
  const authFlag     = getFlag('--auth')

  if (!query) {
    log.error('Please provide a query.')
    console.log(`  Example: npx capman run "show me articles"\n`)
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

  let auth
  if (authFlag) {
    try { auth = JSON.parse(authFlag) } catch {
      log.error('--auth value must be valid JSON, e.g. \'{"isAuthenticated":true,"role":"admin"}\'')
      process.exit(1)
    }
  }

  // Note: capman run matches and shows what would execute — it does NOT call your API.
  // Use --mode balanced|accurate to test the LLM fallback path (requires env API key).
  const engine = new CapmanEngine({ manifest, cache: false, learning: false, mode: modeFlag })
  const result = await engine.ask(query, { dryRun: true, ...(auth ? { auth } : {}) })

  const cap     = result.match.capability
  const matched = !!cap

  if (jsonMode) {
    const action = result.resolution.apiCalls?.[0]
      ? { method: result.resolution.apiCalls[0].method, url: result.resolution.apiCalls[0].url }
      : null
    const out = {
      matched,
      capability:    cap?.id ?? null,
      confidence:    result.match.confidence,
      verdict:       result.verdict,
      margin:        result.margin,
      intent:        result.match.intent,
      resolvedVia:   result.resolvedVia,
      action,
      params:        result.match.extractedParams,
      missingParams: result.missingParams ?? [],
      privacyBlocked: result.resolution.error?.includes('privacy') ||
                      result.resolution.error?.includes('requires') || false,
    }
    console.log(JSON.stringify(out, null, 2))
    if (!matched) process.exit(1)
    return
  }

  if (!jsonMode) log.info(`Query: "${query}"`)
  log.blank()

  if (cap) {
    // Determine verdict color
    const verdictColor = result.verdict === 'clear' ? c.green
      : result.verdict === 'marginal' ? c.yellow : c.gray

    console.log(`  ${c.green}✓${c.reset}  Matched: ${c.bold}${cap.id}${c.reset}`)
    console.log(`     Confidence: ${result.match.confidence}%  ${verdictColor}[${result.verdict}]${c.reset}  margin: ${result.margin}`)
    console.log(`     Intent:     ${result.match.intent}`)
    console.log(`     Via:        ${result.resolvedVia}`)

    // Show the executable API action
    const apiCall = result.resolution.apiCalls?.[0]
    if (apiCall) {
      console.log(`     Action:     ${c.teal}${apiCall.method} ${apiCall.url}${c.reset}`)
    }

    if (Object.keys(result.match.extractedParams).length > 0) {
      const params = Object.entries(result.match.extractedParams)
        .map(([k, v]) => `${k}=${v ?? 'null'}`)
        .join(', ')
      console.log(`     Params:     ${params}`)
    }

    if (result.missingParams?.length) {
      console.log(`     ${c.yellow}⚠  Missing required params: ${result.missingParams.join(', ')}${c.reset}`)
    }

    if (result.resolution.error) {
      console.log(`     ${c.yellow}⚠  ${result.resolution.error}${c.reset}`)
    }

    if (result.verdict === 'marginal') {
      console.log(`     ${c.yellow}⚠  Marginal match — consider asking the user to clarify${c.reset}`)
    }

    if (debug && result.match.candidates.length) {
      log.blank()
      console.log(`  ${c.gray}── All candidates:${c.reset}`)
      result.match.candidates
        .sort((a, b) => b.score - a.score)
        .forEach(c2 => {
          const marker = c2.matched ? c.green + '✓' : c.gray + '○'
          console.log(`     ${marker}${c.reset}  ${c2.capabilityId}: ${c2.score}%`)
        })
    }
  } else {
    console.log(`  ${c.yellow}○${c.reset}  OUT_OF_SCOPE — no capability matched`)
    if (debug && result.match.candidates.length) {
      log.blank()
      console.log(`  ${c.gray}── All candidates:${c.reset}`)
      result.match.candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .forEach(c2 => {
          console.log(`     ${c.gray}○  ${c2.capabilityId}: ${c2.score}%${c.reset}`)
        })
    }
  }
  console.log()
}