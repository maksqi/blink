import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent, H3Error } from 'h3'
import { describe, expect, it } from 'vitest'
import {
  backoffDelayMs,
  consumeOr429,
  createLimiter,
  emailThrottleKey,
  getLimiter,
  loginThrottleKeys,
  nextFailureCount,
  RATE_LIMITS,
  retryAfterSeconds,
  roomPasswordThrottleKey,
  throttleDecision,
} from './limiter'

function clock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

function event() {
  const req = new IncomingMessage(new Socket())
  return createEvent(req, new ServerResponse(req))
}

describe('createLimiter (sliding window)', () => {
  it('allows `limit` hits per window and reports the wait', () => {
    const c = clock()
    const limiter = createLimiter({ name: 't', limit: 3, windowMs: 60_000, now: c.now })
    expect(limiter.consume('a')).toEqual({ allowed: true, remaining: 2, retryAfterMs: 0 })
    c.advance(10_000)
    limiter.consume('a')
    c.advance(10_000)
    expect(limiter.consume('a')).toEqual({ allowed: true, remaining: 0, retryAfterMs: 0 })
    expect(limiter.consume('a')).toEqual({ allowed: false, remaining: 0, retryAfterMs: 40_000 })
    // Other keys are independent.
    expect(limiter.consume('b').allowed).toBe(true)
  })

  it('slides: old hits leave the window one by one', () => {
    const c = clock()
    const limiter = createLimiter({ name: 't', limit: 2, windowMs: 1_000, now: c.now })
    limiter.consume('k')
    c.advance(400)
    limiter.consume('k')
    expect(limiter.consume('k').allowed).toBe(false)
    c.advance(600) // the first hit is exactly one window old
    expect(limiter.consume('k').allowed).toBe(true)
    expect(limiter.consume('k')).toEqual({ allowed: false, remaining: 0, retryAfterMs: 400 })
  })

  it('does not count rejected attempts', () => {
    const c = clock()
    const limiter = createLimiter({ name: 't', limit: 1, windowMs: 1_000, now: c.now })
    limiter.consume('k')
    for (let i = 0; i < 5; i++) limiter.consume('k')
    c.advance(1_000)
    expect(limiter.consume('k').allowed).toBe(true)
  })

  it('peeks without consuming, resets and forgets idle keys', () => {
    const c = clock()
    const limiter = createLimiter({ name: 't', limit: 1, windowMs: 1_000, now: c.now })
    expect(limiter.peek('k').allowed).toBe(true)
    limiter.consume('k')
    expect(limiter.peek('k').allowed).toBe(false)
    limiter.reset('k')
    expect(limiter.peek('k').allowed).toBe(true)
    limiter.consume('x')
    limiter.consume('y')
    c.advance(5_000)
    limiter.consume('z')
    expect(limiter.size).toBe(1)
  })

  it('caps the number of tracked keys', () => {
    const c = clock()
    const limiter = createLimiter({ name: 't', limit: 5, windowMs: 60_000, now: c.now, maxKeys: 10 })
    for (let i = 0; i < 30; i++) limiter.consume(`k${i}`)
    expect(limiter.size).toBeLessThanOrEqual(11)
  })

  it('rejects invalid options', () => {
    expect(() => createLimiter({ name: 'x', limit: 0, windowMs: 1 })).toThrow(RangeError)
    expect(() => createLimiter({ name: 'x', limit: 1, windowMs: 0 })).toThrow(RangeError)
  })
})

describe('shared limiters', () => {
  it('match docs/API.md and are singletons', () => {
    expect(RATE_LIMITS['auth-ip']).toEqual({ limit: 10, windowMs: 60_000 })
    expect(RATE_LIMITS['reset-email']).toEqual({ limit: 3, windowMs: 3_600_000 })
    expect(RATE_LIMITS['join-ip']).toEqual({ limit: 30, windowMs: 60_000 })
    expect(RATE_LIMITS['room-create']).toEqual({ limit: 20, windowMs: 3_600_000 })
    expect(RATE_LIMITS['call-actions']).toEqual({ limit: 120, windowMs: 60_000 })
    expect(RATE_LIMITS['recording-chunks']).toEqual({ limit: 8, windowMs: 1_000 })
    expect(getLimiter('join-ip')).toBe(getLimiter('join-ip'))
    expect(getLimiter('join-ip').limit).toBe(30)
  })
})

describe('consumeOr429', () => {
  it('throws RATE_LIMITED with Retry-After once the limit is reached', () => {
    const c = clock()
    const limiter = createLimiter({ name: 't', limit: 1, windowMs: 90_500, now: c.now })
    const e = event()
    consumeOr429(e, limiter, 'k')
    let thrown: unknown
    try {
      consumeOr429(e, limiter, 'k')
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(H3Error)
    const error = thrown as H3Error<{ code: string; details: { retryAfter: number } }>
    expect(error.statusCode).toBe(429)
    expect(error.data?.code).toBe('RATE_LIMITED')
    expect(error.data?.details.retryAfter).toBe(91)
    expect(String(e.node.res.getHeader('retry-after'))).toBe('91')
  })

  it('rounds Retry-After up to whole seconds, at least 1', () => {
    expect(retryAfterSeconds(1)).toBe(1)
    expect(retryAfterSeconds(1_000)).toBe(1)
    expect(retryAfterSeconds(1_001)).toBe(2)
    expect(retryAfterSeconds(0)).toBe(1)
  })
})

describe('backoff', () => {
  it('gives 5 free failures, then 2^(n-5) seconds capped at 900 s', () => {
    expect([0, 1, 2, 3, 4, 5].map(backoffDelayMs)).toEqual([0, 0, 0, 0, 0, 0])
    expect(backoffDelayMs(6)).toBe(2_000)
    expect(backoffDelayMs(7)).toBe(4_000)
    expect(backoffDelayMs(10)).toBe(32_000)
    expect(backoffDelayMs(14)).toBe(512_000)
    expect(backoffDelayMs(15)).toBe(900_000)
    expect(backoffDelayMs(1_000)).toBe(900_000)
  })

  it('decides over all keys of an attempt', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    expect(throttleDecision([], now)).toEqual({ allowed: true, retryAfterMs: 0 })
    expect(throttleDecision([{ nextAllowedAt: null }, { nextAllowedAt: new Date(now.getTime() - 1) }], now)).toEqual({
      allowed: true,
      retryAfterMs: 0,
    })
    expect(
      throttleDecision([{ nextAllowedAt: new Date(now.getTime() + 2_000) }, { nextAllowedAt: new Date(now.getTime() + 8_000) }], now),
    ).toEqual({ allowed: false, retryAfterMs: 8_000 })
  })

  it('forgets failures older than 24 hours', () => {
    const now = new Date('2026-01-02T00:00:00Z')
    expect(nextFailureCount(undefined, now)).toBe(1)
    expect(nextFailureCount({ failures: 7, updatedAt: new Date('2026-01-01T12:00:00Z') }, now)).toBe(8)
    expect(nextFailureCount({ failures: 7, updatedAt: new Date('2025-12-31T23:59:59Z') }, now)).toBe(1)
  })

  it('builds throttle keys per email and IP (/64 for IPv6)', () => {
    expect(emailThrottleKey('  Admin@Example.TEST ')).toBe('email:admin@example.test')
    expect(loginThrottleKeys('a@example.test', '203.0.113.9')).toEqual(['email:a@example.test', 'ip:203.0.113.9'])
    expect(loginThrottleKeys('a@example.test', '2001:db8:5:6::77')).toEqual(['email:a@example.test', 'net:2001:db8:5:6::/64'])
    expect(roomPasswordThrottleKey('r1', '203.0.113.9')).toBe('room:r1:ip:203.0.113.9')
  })
})
