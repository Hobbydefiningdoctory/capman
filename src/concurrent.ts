/**
 * ConcurrentCapmanEngine — a thin wrapper around CapmanEngine that serialises
 * ask() and explain() calls via an internal promise queue.
 *
 * Use this when sharing a single CapmanEngine instance across concurrent async
 * request handlers (e.g. a long-lived Express server with balanced/accurate mode).
 *
 * Why a promise queue instead of async-mutex:
 *   - Zero external dependencies — no new package.json entries for consumers
 *   - Identical serialisation guarantee to a FIFO mutex
 *   - Simpler audit surface
 *
 * Why opt-in, not default:
 *   - Per-request engine patterns pay zero overhead (recommended for most servers)
 *   - Cheap mode shared engines pay zero overhead
 *   - Consumer retains full control over their concurrency model
 *
 * @example
 * // Safe shared engine across concurrent requests
 * const engine = new ConcurrentCapmanEngine({ manifest, llm, mode: 'balanced' })
 * app.post('/ask', async (req, res) => {
 *   const result = await engine.ask(req.body.query)
 *   res.json(result)
 * })
 */

import { CapmanEngine, type EngineOptions, type EngineResult } from './engine'
import type { Manifest, EngineHealth } from './types'
import type { ResolveOptions } from './resolver'
import type { ExplainResult } from './types'

export class ConcurrentCapmanEngine {
  private engine: CapmanEngine
  /**
   * The tail of the promise chain — each new call appends to this.
   * On rejection, the queue resets to a resolved promise so subsequent
   * calls are not permanently blocked by a single failure.
   */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(options: EngineOptions) {
    this.engine = new CapmanEngine(options)
  }

  ask(query: string, overrides?: Partial<ResolveOptions>): Promise<EngineResult> {
    const result = this.queue.then(() => this.engine.ask(query, overrides))
    // Reset queue tail to resolved on failure — one bad call must not
    // block all subsequent callers indefinitely.
    this.queue = result.catch(() => {})
    return result
  }

  explain(query: string): Promise<ExplainResult> {
    const result = this.queue.then(() => this.engine.explain(query))
    this.queue = result.catch(() => {})
    return result
  }

  // ── Delegated methods — safe to call directly, no serialisation needed ──

  /** Swap the manifest. Safe to call outside the queue — triggers cache clear internally. */
  loadManifest(manifest: Manifest): Promise<void> {
    return this.engine.loadManifest(manifest)
  }

  /** Returns learning stats or null if learning is disabled. */
  getStats() {
    return this.engine.getStats()
  }

  /** Returns top-N most frequently matched capabilities. */
  getTopCapabilities(limit?: number) {
    return this.engine.getTopCapabilities(limit)
  }

/** Clear the cache. */
  clearCache(): Promise<void> {
    return this.engine.clearCache()
  }

  /** Returns engine health snapshot — circuit breaker, LLM rate limit, cache, learning, embedding. */
  health(): Promise<EngineHealth> {
    return this.engine.health()
  }
}