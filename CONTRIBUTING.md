# Contributing to capman

First off — thank you for taking the time to contribute.
capman is an open source project and welcomes contributions of all kinds.

---

## What we're building

capman is a developer tool that lets AI agents interact with applications
efficiently — without navigating the UI. If you're here, you probably
have an idea to make that better. Let's hear it.

---

## Ways to contribute

- **Bug reports** — something broke? Open an issue with steps to reproduce
- **Feature suggestions** — have an idea? Open an issue and describe it
- **Code contributions** — fix a bug or build a feature via pull request
- **New test configs** — tested capman against a real app? Add it to test/
- **Documentation** — spotted something unclear in the README? Fix it

---

## Getting started locally

```bash
# Clone the repo
git clone https://github.com/Hobbydefiningdoctory/capman.git
cd capman

# Install dependencies
npm install

# Build
npm run build

# Run the example
npm run example
```

---

## Project structure

```
src/
  types.ts       — all TypeScript types (the contract)
  generator.ts   — generate(), validate(), loadConfig()
  matcher.ts     — match() and matchWithLLM()
  resolver.ts    — resolve() for API, nav, and hybrid
  index.ts       — public SDK entry point + ask()
bin/
  capman.js      — CLI (init, generate, validate, inspect)
examples/
  basic.ts       — simple runnable example
test/
  conduit.config.js      — real world test config (Conduit app)
  test-conduit.ts        — keyword matcher tests
  test-conduit-llm.ts    — LLM matcher tests
```

---

## Before submitting a pull request

1. Run `npm run build` — make sure it compiles clean
2. Run `npx ts-node examples/basic.ts` — make sure the example works
3. If you changed matching logic, run `npx ts-node test/test-conduit.ts`
4. Keep pull requests focused — one thing per PR
5. Write clear commit messages — say what changed and why

---

## Adding a new test config

If you've tested capman against a real app, we'd love to include it.

1. Create `test/your-app.config.js`
2. Create `test/test-your-app.ts`
3. Open a pull request with both files
4. Include your test results in the PR description

---

## Reporting a bug

Open an issue and include:
- What you ran
- What you expected
- What actually happened
- Your Node.js version (`node --version`)

---

## Code style

- TypeScript everywhere in `src/`
- No external runtime dependencies in core src/
- Keep functions small and focused
- Add a comment if something isn't obvious

---

## Questions?

Open an issue — no question is too small.