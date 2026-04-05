'use strict'

const path = require('path')
const fs   = require('fs')

// ─── Args ─────────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2)
const command = args[0]
const flags   = args.slice(1)

const getFlag = (name) => {
  const i = flags.indexOf(name)
  if (i === -1) return undefined
  const value = flags[i + 1]
  // If next token is another flag or doesn't exist, the flag has no value
  if (value === undefined || value.startsWith('--')) {
    console.error(`${'\x1b[31m'}✗${'\x1b[0m'} Flag "${name}" requires a value. Example: ${name} <value>`)
    process.exit(1)
  }
  return value
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  teal:   '\x1b[36m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  gray:   '\x1b[90m',
}

// ─── Logger ───────────────────────────────────────────────────────────────────

const log = {
  info:    (...a) => console.log(`${c.teal}i${c.reset}`, ...a),
  success: (...a) => console.log(`${c.green}✓${c.reset}`, ...a),
  warn:    (...a) => console.log(`${c.yellow}⚠${c.reset}`, ...a),
  error:   (...a) => console.error(`${c.red}✗${c.reset}`, ...a),
  blank:   ()     => console.log(),
}

// ─── Header ───────────────────────────────────────────────────────────────────

function header() {
  const pkg = require(path.join(__dirname, '..', '..', 'package.json'))
  console.log()
  console.log(`${c.bold}${c.teal}  capman${c.reset} ${c.gray}v${pkg.version} — Capability Manifest Engine${c.reset}`)
  console.log(`${c.gray}  ─────────────────────────────────────────${c.reset}`)
  console.log()
}

// ─── requireSrc ───────────────────────────────────────────────────────────────

function requireSrc() {
  const distPath = path.join(__dirname, '..', '..', 'dist', 'cjs', 'index.js')
  if (fs.existsSync(distPath)) return require(distPath)

  log.info('dist/cjs not found — running build...')
  try {
    require('child_process').execSync('npm run build', {
      cwd: path.join(__dirname, '..', '..'),
      stdio: 'inherit',
    })
    if (fs.existsSync(distPath)) return require(distPath)
  } catch {
    // build failed
  }

  log.error('Cannot find dist/cjs/. Run: pnpm run build')
  process.exit(1)
}

module.exports = { args, command, flags, getFlag, c, log, header, requireSrc }
