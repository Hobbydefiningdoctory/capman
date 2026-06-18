'use strict'

const { header, log, c, flags, getFlag, requireSrc } = require('./shared')

  module.exports = function cmdValidate() {
    const jsonMode = flags.includes('--json')
    if (!jsonMode) header()
    const { readManifest, validate } = requireSrc()

    const manifestPath = getFlag('--manifest') ?? 'manifest.json'
  let manifest
  try {
    manifest = readManifest(manifestPath)
  } catch (e) {
    log.error(e.message)
    process.exit(1)
  }

const result = validate(manifest)

  if (jsonMode) {
    console.log(JSON.stringify({ valid: result.valid, errors: result.errors, warnings: result.warnings }, null, 2))
    if (!result.valid) process.exit(1)
    return
  }

  log.info(`Validating ${c.bold}${manifestPath}${c.reset}...`)
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
