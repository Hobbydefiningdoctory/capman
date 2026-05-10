'use strict'

const { header, c } = require('./shared')

module.exports = function cmdHelp() {
  header()
  console.log(`${c.bold}  Usage:${c.reset}  capman <command>`)
  console.log()
  console.log(`${c.bold}  Commands:${c.reset}`)
  console.log(`    ${c.teal}init${c.reset}                         Create a starter capman.config.js`)
  console.log(`    ${c.teal}generate${c.reset}                     Generate manifest from capman.config.js`)
  console.log(`    ${c.teal}generate --from <path|url>${c.reset}   Generate from OpenAPI/Swagger spec`)
  console.log(`    ${c.teal}generate --ai${c.reset}                Generate manifest using AI`)
  console.log(`    ${c.teal}validate${c.reset}                     Validate an existing manifest.json`)
  console.log(`    ${c.teal}generate --enrich-examples${c.reset}   Add 20 phrasings per capability via LLM`)
  console.log(`    ${c.teal}inspect${c.reset}                      Print all capabilities in manifest`)
  console.log(`    ${c.teal}demo${c.reset}                         Run a live demo with sample queries`)
  console.log(`    ${c.teal}run "query"${c.reset}                  Run a query against your manifest`)
  console.log(`    ${c.teal}run "query" --debug${c.reset}          Run with full candidate scoring`)
  console.log(`    ${c.teal}explain "query"${c.reset}              Explain what would match without executing`)
  console.log()
  console.log(`${c.bold}  Options:${c.reset}`)
  console.log(`    ${c.gray}--config    Path to config file  (default: capman.config.js)${c.reset}`)
  console.log(`    ${c.gray}--out       Output path          (default: manifest.json)${c.reset}`)
  console.log(`    ${c.gray}--manifest  Manifest to read     (default: manifest.json)${c.reset}`)
  console.log(`    ${c.gray}                                  Requires API key. Run after --ai or --from.${c.reset}`)
  console.log(`    ${c.gray}                                  Skips caps with ≥ 20 examples already.${c.reset}`)
  console.log()
}
