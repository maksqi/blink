/**
 * Structured logger with redaction (server-core, docs/SECURITY.md §8).
 *
 * - `logger`: root logger honoring `LOG_LEVEL` (fatal..trace, default info) and `LOG_FORMAT` (`pretty` | `json`).
 *   `logger.info('message', { fields })`, `logger.child({ requestId })`.
 * - `requestLogger(event)`: child logger bound to the request id.
 * - `createLogger(options)`: custom sinks and clocks (tests).
 * - `redact(value)` / `redactText(text)`: every record passes through them. Removes values of sensitive keys
 *   (passwords, tokens, proofs, secrets, cookies, authorization, room keys), and in strings: `#k=` / `#t=` and bare
 *   fragment tokens, credential query values (`access_token=`, `token=`, ...), bearer/basic credentials, blinq
 *   cookies, JWTs, 43-character opaque tokens and argon2 hashes.
 *
 * (decision) Written without consola: consola is only a transitive dependency and cannot be imported from project
 * code. The output mirrors consola's levels; swapping the sink (`write`) is enough to move to consola later.
 */
import { writeSync } from 'node:fs'
import type { H3Event } from 'h3'

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'
export type LogFormat = 'pretty' | 'json'
export type LogFields = Record<string, unknown>

export interface Logger {
  fatal(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  debug(message: string, fields?: LogFields): void
  trace(message: string, fields?: LogFields): void
  child(bindings: LogFields): Logger
  enabled(level: LogLevel): boolean
}

export interface LoggerOptions {
  level?: LogLevel
  format?: LogFormat
  bindings?: LogFields
  /** Receives one formatted line (without newline). Default: stdout, stderr for warn and above. */
  write?: (line: string, level: LogLevel) => void
  now?: () => Date
  color?: boolean
}

const LEVELS: Record<LogLevel, number> = { fatal: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 }
const COLORS: Record<LogLevel, string> = {
  fatal: '\x1b[41m',
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[36m',
  debug: '\x1b[90m',
  trace: '\x1b[90m',
}

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && value in LEVELS
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const settings = {
    level: options.level,
    format: options.format,
    write: options.write ?? defaultWrite,
    now: options.now ?? (() => new Date()),
    color: options.color,
  }
  return build(settings, options.bindings ?? {})
}

interface Settings {
  level: LogLevel | undefined
  format: LogFormat | undefined
  write: (line: string, level: LogLevel) => void
  now: () => Date
  color: boolean | undefined
}

function build(settings: Settings, bindings: LogFields): Logger {
  const threshold = () => settings.level ?? (isLogLevel(process.env.LOG_LEVEL) ? process.env.LOG_LEVEL : 'info')
  const enabled = (level: LogLevel) => LEVELS[level] <= LEVELS[threshold()]
  const log = (level: LogLevel) => (message: string, fields?: LogFields) => {
    if (!enabled(level)) return
    const format = settings.format ?? (process.env.LOG_FORMAT === 'json' ? 'json' : 'pretty')
    const data = redact({ ...bindings, ...fields }) as LogFields
    const line =
      format === 'json'
        ? safeJson(jsonRecord(settings.now(), level, redactText(message), data))
        : pretty(settings, level, redactText(message), data)
    settings.write(line, level)
  }
  return {
    fatal: log('fatal'),
    error: log('error'),
    warn: log('warn'),
    info: log('info'),
    debug: log('debug'),
    trace: log('trace'),
    child: (extra) => build(settings, { ...bindings, ...extra }),
    enabled,
  }
}

/** `time`, `level` and `msg` come first and cannot be overwritten by fields (those get a `field_` prefix). */
function jsonRecord(time: Date, level: LogLevel, msg: string, data: LogFields): LogFields {
  const record: LogFields = { time: time.toISOString(), level, msg }
  for (const [key, value] of Object.entries(data)) record[key in record ? `field_${key}` : key] = value
  return record
}

function pretty(settings: Settings, level: LogLevel, message: string, data: LogFields): string {
  const color = settings.color ?? (Boolean(process.stdout.isTTY) && !process.env.NO_COLOR)
  const label = level.toUpperCase().padEnd(5)
  const head = `${settings.now().toISOString()} ${color ? `${COLORS[level]}${label}\x1b[0m` : label} ${message}`
  let stack = ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    if (isSerializedError(value) && value.stack) stack = `\n${value.stack}`
    parts.push(`${key}=${typeof value === 'string' && !/\s/.test(value) ? value : safeJson(value)}`)
  }
  return `${head}${parts.length ? `  ${parts.join(' ')}` : ''}${stack}`
}

function defaultWrite(line: string, level: LogLevel) {
  const fd = LEVELS[level] <= LEVELS.warn ? 2 : 1
  if (level === 'fatal') {
    // Fatal lines usually precede process.exit(): write synchronously so they are never lost.
    try {
      writeSync(fd, `${line}\n`)
    } catch {
      // Nothing left to report to.
    }
    return
  }
  ;(fd === 2 ? process.stderr : process.stdout).write(`${line}\n`)
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))
  } catch {
    return '"[unserializable]"'
  }
}

export const logger: Logger = createLogger()

export function requestLogger(event: H3Event): Logger {
  const requestId = event.context.requestId
  return requestId ? logger.child({ requestId }) : logger
}

// ---- Redaction ----------------------------------------------------------------------------------------------------

export const REDACTED = '[redacted]'

const SENSITIVE_KEY =
  /pass(?:word|wd|phrase)?|secret|token|authorization|cookie|proof|credential|signature|api[-_]?key|private[-_]?key|(?:room|media|chat|invite|encryption|recording)[-_]?key|^k$|^otp$/i

const TEXT_RULES: Array<[RegExp, string]> = [
  // Fragment secrets: #k=<room key>, &t=<invite token>, and bare fragment tokens (/invite#<token>).
  [/([#&](?:k|t)=)[^&\s"'<>]+/g, `$1${REDACTED}`],
  [/#[A-Za-z0-9_-]{20,}/g, `#${REDACTED}`],
  // Credential-bearing query parameters.
  [/([?&](?:access_token|token|t|k|proof|password|secret|signature)=)[^&\s"'<>#]+/gi, `$1${REDACTED}`],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`],
  [/((?:__Host-)?blinq_(?:session|g_[a-z-]+)=)[^;\s"']+/g, `$1${REDACTED}`],
  // JWTs (LiveKit tokens, webhook signatures).
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, REDACTED],
  [/\$argon2(?:id|i|d)\$[^\s"']+/g, REDACTED],
  // Drizzle puts bound query parameters (hashes, emails, ...) into error messages: "Failed query: ...\nparams: ...".
  [/(\nparams: )[^\n]*/g, `$1${REDACTED}`],
  // Opaque 32-byte tokens and join proofs (43 base64url characters).
  [/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g, REDACTED],
]

export function redactText(text: string): string {
  let out = text
  for (const [pattern, replacement] of TEXT_RULES) out = out.replace(pattern, replacement)
  return out
}

interface SerializedError {
  name: string
  message: string
  code?: string
  stack?: string
  cause?: unknown
}

function isSerializedError(value: unknown): value is SerializedError {
  return typeof value === 'object' && value !== null && 'name' in value && 'message' in value && 'stack' in value
}

export function redact(value: unknown): unknown {
  return redactValue(value, 0, new WeakSet())
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactText(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
  if (value instanceof Uint8Array) return `[${value.byteLength} bytes]`
  if (seen.has(value)) return '[circular]'
  if (depth >= 6) return '[depth limit]'
  seen.add(value)
  if (value instanceof Error) {
    const error: SerializedError = { name: value.name, message: redactText(value.message) }
    const code = (value as { code?: unknown }).code
    if (typeof code === 'string' || typeof code === 'number') error.code = String(code)
    if (value.stack) error.stack = redactText(value.stack)
    if (value.cause !== undefined) error.cause = redactValue(value.cause, depth + 1, seen)
    return error
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactValue(item, depth + 1, seen))
  const entries = value instanceof Map ? [...value.entries()].map(([k, v]) => [String(k), v] as const) : Object.entries(value)
  const out: Record<string, unknown> = {}
  for (const [key, item] of entries) {
    out[key] = SENSITIVE_KEY.test(key) && item !== null && item !== undefined ? REDACTED : redactValue(item, depth + 1, seen)
  }
  return out
}
