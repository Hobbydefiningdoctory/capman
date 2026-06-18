#!/usr/bin/env node
'use strict'

const { command, header, log, c } = require('./lib/shared')

;(async () => {
  switch (command) {
    case 'init':     require('./lib/cmd-init')();          break
    case 'generate': await require('./lib/cmd-generate')(); break
    case 'validate': require('./lib/cmd-validate')();       break
    case 'inspect':  require('./lib/cmd-inspect')();        break
    case 'demo':     require('./lib/cmd-demo')();           break
    case 'run':      require('./lib/cmd-run')();            break
    case 'explain':  await require('./lib/cmd-explain')();  break
    case 'test':     await require('./lib/cmd-test')();     break
    case 'health':   await require('./lib/cmd-health')();   break
    case undefined:
    case '--help':
    case '-h':       require('./lib/cmd-help')();           break
    default:
      header()
      log.error(`Unknown command: ${command}`)
      console.log(`  Run: ${c.teal}capman --help${c.reset}\n`)
      process.exit(1)
  }
})()
