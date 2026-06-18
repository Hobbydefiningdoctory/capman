'use strict'

const { header, log, c, flags, getFlag, requireSrc } = require('./shared')

module.exports = async function cmdHealth() {
  const jsonMode     = flags.includes('--json')
  const manifestPath = getFlag('--manifest') ?? 'manifest.json'
  if (!jsonMode) header()

  const { readManifest, CapmanEngine } = requireSrc()

  let manifest
  try {
    manifest = readManifest(manifestPath)
  } catch (e) {
    log.error(e.message)
    process.exit(1)
  }

  const engine = new CapmanEngine({ manifest, cache: true, learning: false, mode: 'cheap' })
  const h = await engine.health()

  if (jsonMode) {
    console.log(JSON.stringify(h, null, 2))
    if (h.status === 'unhealthy') process.exit(1)
    return
  }

  const statusColor = h.status === 'healthy' ? c.green : h.status === 'degraded' ? c.yellow : c.red
  console.log(`  ${statusColor}${h.status}${c.reset}`)
  console.log()
  console.log(`  ${c.gray}manifest:${c.reset}   ${h.manifest.app}  ·  ${h.manifest.capabilityCount} capabilities  ·  schema v${h.manifest.schemaVersion}`)
  console.log(`  ${c.gray}llm:${c.reset}        circuit ${h.llm.circuitBreakerOpen ? c.red + 'open' : c.green + 'closed'}${c.reset}  ·  ${h.llm.callsThisMinute}/${h.llm.maxCallsPerMinute} calls this minute  ·  ${h.llm.consecutiveFails} consecutive fails`)
  if (h.llm.circuitBreakerResetIn) {
    console.log(`  ${c.gray}            resets in ${Math.round(h.llm.circuitBreakerResetIn / 1000)}s${c.reset}`)
  }
  console.log(`  ${c.gray}cache:${c.reset}      ${h.cache.enabled ? 'enabled' : 'disabled'}  ·  ${h.cache.size} entries`)
  console.log(`  ${c.gray}learning:${c.reset}   ${h.learning.enabled ? 'enabled' : 'disabled'}  ·  ${h.learning.totalQueries} queries recorded`)
  console.log(`  ${c.gray}embedding:${c.reset}  ${h.embedding.enabled ? (h.embedding.ready ? c.green + 'ready' : c.yellow + 'encoding…') : 'disabled'}${c.reset}`)
  console.log()

  if (h.status === 'unhealthy') process.exit(1)
}