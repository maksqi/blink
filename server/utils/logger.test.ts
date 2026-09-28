import { describe, expect, it } from 'vitest'
import { randomToken } from './crypto'
import { createLogger, redact, REDACTED, redactText, type LogLevel } from './logger'

function capture(options: Parameters<typeof createLogger>[0] = {}) {
  const lines: Array<{ line: string; level: LogLevel }> = []
  const log = createLogger({
    format: 'json',
    level: 'info',
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    write: (line, level) => lines.push({ line, level }),
    ...options,
  })
  return { log, lines, records: () => lines.map((l) => JSON.parse(l.line) as Record<string, unknown>) }
}

describe('logger', () => {
  it('filters by level', () => {
    const { log, lines } = capture({ level: 'warn' })
    log.info('hidden')
    log.debug('hidden')
    log.warn('shown')
    log.error('shown')
    log.fatal('shown')
    expect(lines.map((l) => l.level)).toEqual(['warn', 'error', 'fatal'])
    expect(log.enabled('warn')).toBe(true)
    expect(log.enabled('info')).toBe(false)
  })

  it('writes one JSON object per line with time, level and msg first', () => {
    const { log, lines, records } = capture()
    log.info('request', { method: 'GET', status: 200, level: 'spoofed' })
    expect(lines[0]!.line).not.toContain('\n')
    expect(Object.keys(records()[0]!).slice(0, 3)).toEqual(['time', 'level', 'msg'])
    expect(records()[0]).toEqual({
      time: '2026-01-01T00:00:00.000Z',
      level: 'info',
      msg: 'request',
      method: 'GET',
      status: 200,
      field_level: 'spoofed',
    })
  })

  it('binds fields in child loggers', () => {
    const { log, records } = capture()
    const child = log.child({ requestId: 'req-1' }).child({ userId: 'u-1' })
    child.info('hello')
    expect(records()[0]).toMatchObject({ requestId: 'req-1', userId: 'u-1', msg: 'hello' })
  })

  it('formats pretty lines with level and fields', () => {
    const { log, lines } = capture({ format: 'pretty', color: false })
    log.warn('slow request', { path: '/api/rooms', durationMs: 812 })
    expect(lines[0]!.line).toBe('2026-01-01T00:00:00.000Z WARN  slow request  path=/api/rooms durationMs=812')
  })

  it('redacts secrets in fields and messages', () => {
    const { log, lines } = capture()
    const token = randomToken()
    log.info(`login for session ${token}`, {
      password: 'hunter2hunter2',
      newPassword: 'another-secret-value',
      inviteToken: token,
      proof: 'proof-value',
      headers: { cookie: 'blinq_session=abc', authorization: 'Bearer abc.def', accept: 'application/json' },
      url: `https://meet.example.test/m/abc-defg-hjk#k=${token}&t=${token}`,
    })
    const line = lines[0]!.line
    expect(line).not.toContain(token)
    expect(line).not.toContain('hunter2hunter2')
    expect(line).not.toContain('another-secret-value')
    expect(line).not.toContain('proof-value')
    expect(line).not.toContain('Bearer abc')
    expect(line).not.toContain('blinq_session=abc')
    expect(line).toContain('application/json')
  })

  it('serializes errors and survives circular structures', () => {
    const { log, records } = capture()
    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular
    log.error('failed', { err: new Error(`bad token ${randomToken()}`), circular })
    const record = records()[0]!
    expect(record.err).toMatchObject({ name: 'Error', message: `bad token ${REDACTED}` })
    expect(record.circular).toEqual({ name: 'loop', self: '[circular]' })
  })
})

describe('redactText', () => {
  const token = randomToken()

  it.each([
    [`/m/abc-defg-hjk#k=${token}`, `/m/abc-defg-hjk#k=${REDACTED}`],
    [`/m/abc-defg-hjk#k=secretkey&t=invitetoken`, `/m/abc-defg-hjk#k=${REDACTED}&t=${REDACTED}`],
    [`https://x.test/invite#${token}`, `https://x.test/invite#${REDACTED}`],
    [`/reset-password#abcdefghijklmnopqrstuvwxyz`, `/reset-password#${REDACTED}`],
    ['/rtc?access_token=eyJabc.def.ghi&auto=1', `/rtc?access_token=${REDACTED}&auto=1`],
    ['/api/x?token=abc123&page=2', `/api/x?token=${REDACTED}&page=2`],
    ['Authorization: Bearer abc.def-ghi', `Authorization: Bearer ${REDACTED}`],
    ['cookie: __Host-blinq_session=abc; other=1', `cookie: __Host-blinq_session=${REDACTED}; other=1`],
    ['cookie: blinq_g_abc-defg-hjk=xyz', `cookie: blinq_g_abc-defg-hjk=${REDACTED}`],
    ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl done', `jwt ${REDACTED} done`],
    ['hash $argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA end', `hash ${REDACTED} end`],
    [`plain ${token} text`, `plain ${REDACTED} text`],
  ])('%s', (input, expected) => {
    expect(redactText(input)).toBe(expected)
  })

  it('leaves ordinary text alone', () => {
    const text = 'GET /api/rooms/0192d2f4-7a3b-7cde-8f01-23456789abcd 200 12ms color #fff'
    expect(redactText(text)).toBe(text)
  })
})

describe('redact', () => {
  it('redacts sensitive keys at any depth, keeps structure and falsy values', () => {
    expect(
      redact({
        user: { email: 'a@example.test', passwordHash: '$argon2id$...', token: null },
        list: [{ secret: 's' }, { apiKey: 'k' }, { k: 'room-key' }],
        settings: { key: 'registration.mode', value: 'open' },
      }),
    ).toEqual({
      user: { email: 'a@example.test', passwordHash: REDACTED, token: null },
      list: [{ secret: REDACTED }, { apiKey: REDACTED }, { k: REDACTED }],
      settings: { key: 'registration.mode', value: 'open' },
    })
  })

  it('converts dates, bytes and bigints', () => {
    expect(redact({ at: new Date('2026-01-01T00:00:00Z'), bytes: new Uint8Array(4), n: 10n })).toEqual({
      at: '2026-01-01T00:00:00.000Z',
      bytes: '[4 bytes]',
      n: '10',
    })
  })
})
