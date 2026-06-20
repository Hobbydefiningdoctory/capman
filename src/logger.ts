// ─── Log levels ───────────────────────────────────────────────────────────────

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug'

export interface CapmanLogger {
  error(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  info(msg: string, ...args: unknown[]): void
  debug(msg: string, ...args: unknown[]): void
}

const LEVELS: Record<LogLevel, number> = {
  silent: 0,
  error:  1,
  warn:   2,
  info:   3,
  debug:  4,
}

// ─── Logger ───────────────────────────────────────────────────────────────────

export class Logger {
  private level: number
  /**
   * Optional sink override. When set, log calls that pass the level filter
   * are routed here instead of console.*. Set via CapmanEngine's `logger`
   * option. This is a single global sink (consistent with the existing
   * global setLogLevel() behavior) — running multiple CapmanEngine instances
   * with different custom loggers in the same process will have the last
   * one constructed win. For per-instance log routing, wrap your sink to
   * tag output with an instance identifier yourself.
   */
  private sink: CapmanLogger | null = null

  constructor(level: LogLevel = 'silent') {
    this.level = LEVELS[level]
  }

  setLevel(level: LogLevel) {
    this.level = LEVELS[level]
  }

  setSink(sink: CapmanLogger | null) {
    this.sink = sink
  }

  error(msg: string, ...args: unknown[]) {
    if (this.level < LEVELS.error) return
    if (this.sink) this.sink.error(msg, ...args)
    else console.error(`[capman:error] ${msg}`, ...args)
  }

  warn(msg: string, ...args: unknown[]) {
    if (this.level < LEVELS.warn) return
    if (this.sink) this.sink.warn(msg, ...args)
    else console.warn(`[capman:warn] ${msg}`, ...args)
  }

  info(msg: string, ...args: unknown[]) {
    if (this.level < LEVELS.info) return
    if (this.sink) this.sink.info(msg, ...args)
    else console.log(`[capman:info] ${msg}`, ...args)
  }

  debug(msg: string, ...args: unknown[]) {
    if (this.level < LEVELS.debug) return
    if (this.sink) this.sink.debug(msg, ...args)
    else console.log(`[capman:debug] ${msg}`, ...args)
  }
}

// ─── Global logger instance ───────────────────────────────────────────────────

export const logger = new Logger('silent')

/**
 * Set the global log level for capman.
 *
 * @example
 * import { setLogLevel } from 'capman'
 * setLogLevel('debug') // see everything
 * setLogLevel('info')  // see key steps
 * setLogLevel('silent') // no output (default)
 */
export function setLogLevel(level: LogLevel) {
  logger.setLevel(level)
}