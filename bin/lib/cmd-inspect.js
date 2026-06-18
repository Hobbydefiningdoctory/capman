  'use strict'

const { header, log, c, flags, getFlag, requireSrc } = require('./shared')

    module.exports = function cmdInspect() {
      const jsonMode = flags.includes('--json')
      if (!jsonMode) header()
      const { readManifest } = requireSrc()

    const manifestPath = getFlag('--manifest') ?? 'manifest.json'
    let manifest
    try {
      manifest = readManifest(manifestPath)
    } catch (e) {
      log.error(e.message)
      process.exit(1)
    }

    if (jsonMode) {
      console.log(JSON.stringify(manifest, null, 2))
      return
    }
    console.log(`${c.bold}  App:${c.reset}          ${manifest.app}`)
    console.log(`${c.bold}  Generated:${c.reset}    ${manifest.generatedAt}`)
    console.log(`${c.bold}  Capabilities:${c.reset} ${manifest.capabilities.length}`)
    console.log()

    for (const cap of manifest.capabilities) {
      const col = cap.resolver.type === 'hybrid' ? c.yellow : c.teal
      console.log(`  ${c.bold}${cap.name}${c.reset}  ${col}[${cap.resolver.type}]${c.reset}  ${c.gray}${cap.privacy.level}${c.reset}`)
      console.log(`  ${c.gray}id: ${cap.id}${c.reset}`)
      console.log(`  ${cap.description}`)
      if (cap.examples?.length) {
        console.log(`  ${c.gray}e.g. "${cap.examples[0]}"${c.reset}`)
      }
      console.log()
    }
  }
