'use strict'

const path = require('path')
const fs   = require('fs')
const { header, log, c, flags, getFlag, requireSrc } = require('./shared')
// ─── Path safety guard ────────────────────────────────────────────────────────

function safeOutputPath(rawPath, cwd) {
  const resolved = path.resolve(cwd, rawPath)
  if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
    log.error(`Output path "${rawPath}" resolves outside the working directory.`)
    console.log(`  Resolved: ${resolved}`)
    console.log(`  Allowed:  ${cwd}`)
    process.exit(1)
  }
  return resolved
}



// ─── AI prompt builder ────────────────────────────────────────────────────────

function buildAIPrompt(description) {
  return `You are helping generate a capman capability manifest config.

The user's app description:
${JSON.stringify({ app_description: description })}

Generate a valid capman config as a JSON object (not module.exports, just the raw JSON object).

The config must follow this exact structure:
{
  "app": "app-name-in-kebab-case",
  "baseUrl": "https://api.your-app.com",
  "capabilities": [
    {
      "id": "snake_case_id",
      "name": "Human readable name",
      "description": "What this capability does (min 10 chars)",
      "examples": ["Example query 1", "Example query 2", "Example query 3"],
      "params": [
        {
          "name": "param_name",
          "description": "What this param is",
          "required": true,
          "source": "user_query"
        }
      ],
      "returns": ["resource_name"],
      "resolver": {
        "type": "api",
        "endpoints": [{ "method": "GET", "path": "/resource/{param_name}" }]
      },
      "privacy": { "level": "public" }
    }
  ]
}

Rules:
- privacy.level must be "public", "user_owned", or "admin"
- resolver.type must be "api", "nav", or "hybrid"
- method must be "GET", "POST", "PUT", "PATCH", or "DELETE"
- source must be "user_query", "session", "context", or "static"
- Generate 3-8 capabilities based on the description
- Each capability needs at least 2 examples
- Respond ONLY with the raw JSON object — no markdown, no explanation`
}

// ─── LLM caller ───────────────────────────────────────────────────────────────

async function callLLM(provider, apiKey, prompt) {
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error?.message ?? res.statusText)
    return data.content[0].text
  }

  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error?.message ?? res.statusText)
    return data.choices[0].message.content
  }

  if (provider === 'openrouter') {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/Hobbydefiningdoctory/capman',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b:free',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
        provider: { order: ['open-inference'], allow_fallbacks: true },
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error?.message ?? res.statusText)
    return data.choices[0].message.content
  }

  throw new Error(`Unknown provider: ${provider}`)
}

// ─── Command ──────────────────────────────────────────────────────────────────

module.exports = async function cmdGenerate() {
  header()
  const { generate, loadConfig, writeManifest, validate, parseOpenAPI } = requireSrc()

const fromFlag  = getFlag('--from')
  const aiFlag    = flags.includes('--ai')
  const cwd       = process.cwd()
  const outPath   = safeOutputPath(getFlag('--out') ?? 'manifest.json', cwd)
  const configOut = safeOutputPath(getFlag('--config-out') ?? 'capman.config.js', cwd)

  
  // ── Path 1: OpenAPI parser ───────────────────────────────────────────────
  if (fromFlag) {
    log.info(`Parsing OpenAPI spec: ${fromFlag}`)
    let result
    try {
      result = await parseOpenAPI(fromFlag)
    } catch (e) {
      log.error(e.message)
      process.exit(1)
    }

    const { config, stats } = result

    log.success(`Parsed ${stats.total} capabilities from spec`)
    if (stats.skipped > 0) log.info(`Skipped ${stats.skipped} operations (insufficient info)`)
    if (stats.warnings.length) stats.warnings.forEach(w => log.warn(w))

    const configContent = `// Auto-generated by capman from OpenAPI spec
    // Review and adjust before committing

    module.exports = ${JSON.stringify(config, null, 2)}
    `
    fs.writeFileSync(configOut, configContent)
    log.success(`Config written to ${configOut}`)

    try {
      const manifest = generate(config)
      writeManifest(manifest, outPath)
      log.success(`Manifest written to ${outPath}`)
      log.info(`${manifest.capabilities.length} capabilities registered`)
    } catch (e) {
      log.warn(`Could not generate manifest: ${e.message}`)
    }

    console.log()
    console.log(`  ${c.gray}Next steps:${c.reset}`)
    console.log(`  1. Review ${c.teal}${configOut}${c.reset} — adjust descriptions and examples`)
    console.log(`  2. Run ${c.teal}npx capman validate${c.reset} to check your manifest`)
    console.log(`  3. Run ${c.teal}npx capman demo${c.reset} to see it in action`)
    console.log()
    return
  }

  // ── Path 2: LLM-assisted ─────────────────────────────────────────────────
  if (aiFlag) {
    log.info('LLM-assisted manifest generation')
    console.log()

    const readline = require('readline')
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const ask = (q) => new Promise(resolve => rl.question(q, resolve))

    console.log(`  ${c.gray}Describe your app and its main capabilities.${c.reset}`)
    console.log(`  ${c.gray}Example: "A CRM app. Users can create contacts, log calls,`)
    console.log(`  view pipeline stages. Admins can manage teams and billing."${c.reset}\n`)

    const description = await ask(`  ${c.teal}>${c.reset} `)
    rl.close()

    if (!description.trim()) {
      log.error('No description provided.')
      process.exit(1)
    }

    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY
    const provider =
      process.env.ANTHROPIC_API_KEY  ? 'anthropic' :
      process.env.OPENAI_API_KEY     ? 'openai' :
      process.env.OPENROUTER_API_KEY ? 'openrouter' : null

    if (!apiKey || !provider) {
      log.error('No LLM API key found.')
      console.log(`  Set one of: ${c.teal}ANTHROPIC_API_KEY${c.reset}, ${c.teal}OPENAI_API_KEY${c.reset}, or ${c.teal}OPENROUTER_API_KEY${c.reset}`)
      process.exit(1)
    }

    log.info(`Using ${provider} to generate manifest...`)

    let raw
    try {
      raw = await callLLM(provider, apiKey, buildAIPrompt(description))
    } catch (e) {
      log.error(`LLM call failed: ${e.message}`)
      process.exit(1)
    }

    let config
    try {
      const clean = raw.replace(/```json|```javascript|```js|```/g, '').trim()
      const match = clean.match(/module\.exports\s*=\s*(\{[\s\S]+\})/)
      config = JSON.parse(match ? match[1] : clean)
    } catch (e) {
      log.error('Could not parse LLM response. Try again or use --from with an OpenAPI spec.')
      console.log(`\n  Raw response:\n${raw.slice(0, 500)}`)
      process.exit(1)
    }

    const configContent = `// Auto-generated by capman AI\n// Review before committing\n\nmodule.exports = ${JSON.stringify(config, null, 2)}\n`
    fs.writeFileSync(configOut, configContent)
    log.success(`Config written to ${configOut}`)

    try {
      const manifest = generate(config)
      writeManifest(manifest, outPath)
      log.success(`Manifest written to ${outPath}`)
      log.info(`${manifest.capabilities.length} capabilities generated`)
    } catch (e) {
      log.warn(`Manifest generation failed — review your config: ${e.message}`)
    }

    console.log()
    console.log(`  ${c.gray}Review ${configOut} — the AI may have missed things.${c.reset}`)
    console.log(`  ${c.teal}npx capman validate${c.reset}   ${c.gray}→ check for errors${c.reset}`)
    console.log(`  ${c.teal}npx capman inspect${c.reset}    ${c.gray}→ see all capabilities${c.reset}`)
    console.log()
    return
  }

  // ── Path 3: Manual ───────────────────────────────────────────────────────
  const configPath = getFlag('--config')
  log.info('Loading config...')
  let config
  try {
    config = loadConfig(configPath)
  } catch (e) {
    log.error(e.message)
    process.exit(1)
  }

  log.info(`Generating manifest for ${config.app}...`)

  let manifest
  try {
    manifest = generate(config)
  } catch (e) {
    log.error(`Generation failed: ${e.message}`)
    process.exit(1)
  }

  const validation = validate(manifest)
  if (!validation.valid) {
    validation.errors.forEach(e => log.error(e))
    process.exit(1)
  }
  if (validation.warnings.length) {
    validation.warnings.forEach(w => log.warn(w))
  }

  writeManifest(manifest, outPath)
  log.success(`Manifest written to ${outPath}`)
  log.info(`${manifest.capabilities.length} capabilities registered`)
  console.log()
}