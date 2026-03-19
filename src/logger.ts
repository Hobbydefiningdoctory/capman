// ─── Log levels ───────────────────────────────────────────────────────────────

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug'

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

  constructor(level: LogLevel = 'silent') {
    this.level = LEVELS[level]
  }

  setLevel(level: LogLevel) {
    this.level = LEVELS[level]
  }

  error(msg: string, ...args: unknown[]) {
    if (this.level >= LEVELS.error)
      console.error(`[capman:error] ${msg}`, ...args)
  }

  warn(msg: string, ...args: unknown[]) {
    if (this.level >= LEVELS.warn)
      console.warn(`[capman:warn] ${msg}`, ...args)
  }

  info(msg: string, ...args: unknown[]) {
    if (this.level >= LEVELS.info)
      console.log(`[capman:info] ${msg}`, ...args)
  }

  debug(msg: string, ...args: unknown[]) {
    if (this.level >= LEVELS.debug)
      console.log(`[capman:debug] ${msg}`, ...args)
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