import { createEvent, H3Error } from 'h3'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { describe, expect, it } from 'vitest'
import {
  backoffDelayMs,
  createLoginThrottle,
  emailThrottleKey,
  loginThrottleKeys,
  memoryThrottleStore,
} from './throttle'

const SECOND = 1_000

function event() {
  const req = new IncomingMessage(new Socket())
  return createEvent(req, new ServerResponse(req))
}

describe('backoff curve', () => {
  it('allows 5 free failures, then doubles from 2 s', () => {
    expect([0, 1, 2, 3, 4, 5].map(backoffDelayMs)).toEqual([0, 0, 0, 0, 0, 0])
    expect(backoffDelayMs(6)).toBe(2 * SECOND)
    expect(backoffDelayMs(7)).toBe(4 * SECOND)
    expect(backoffDelayMs(8)).toBe(8 * SECOND)
    expect(backoffDelayMs(14)).toBe(512 * SECOND)
  })

  it('is capped at 900 s and never becomes a lockout', () => {
    expect(backoffDelayMs(15)).toBe(900 * SECOND)
    expect(backoffDelayMs(1_000)).toBe(900 * SECOND)
  })
})

describe('login throttle keys', () => {
  it('uses the lowercased email plus the IPv4 address', () => {
    expect(loginThrottleKeys(' Alice@Example.TEST ', '203.0.113.9')).toEqual([
      'email:alice@example.test',
      'ip:203.0.113.9',
    ])
  })

  it('aggregates IPv6 clients by /64 (net: keys)', () => {
    const a = loginThrottleKeys('a@example.test', '2001:db8:1:2::5')
    const b = loginThrottleKeys('a@example.test', '2001:db8:1:2:ffff:1:2:3')
    expect(a[1]).toBe('net:2001:db8:1:2::/64')
    expect(b[1]).toBe(a[1])
    expect(loginThrottleKeys('a@example.test', '2001:db8:1:3::5')[1]).toBe('net:2001:db8:1:3::/64')
  })
})

describe('login throttle', () => {
  const keys = loginThrottleKeys('victim@example.test', '198.51.100.20')

  it('blocks after the free failures with a Retry-After, then lets the next attempt through', async () => {
    const throttle = createLoginThrottle(memoryThrottleStore())
    const t0 = new Date('2026-09-28T10:00:00Z')
    for (let i = 0; i < 5; i++) {
      expect((await throttle.check(keys, t0)).allowed).toBe(true)
      await throttle.recordFailure(keys, t0)
    }
    expect((await throttle.check(keys, t0)).allowed).toBe(true)
    await throttle.recordFailure(keys, t0) // 6th failure: 2 s
    expect(await throttle.check(keys, t0)).toEqual({ allowed: false, retryAfterMs: 2 * SECOND })
    expect((await throttle.check(keys, new Date(t0.getTime() + 2 * SECOND))).allowed).toBe(true)

    const e = event()
    const error = await throttle.assertAllowed(e, keys, t0).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(H3Error)
    expect((error as H3Error).statusCode).toBe(429)
    expect((error as H3Error).data).toEqual({ code: 'RATE_LIMITED', details: { retryAfter: 2 } })
    expect(e.node.res.getHeader('retry-after')).toBe(2)
  })

  it('never shortens a running wait', async () => {
    const store = memoryThrottleStore()
    const throttle = createLoginThrottle(store)
    const t0 = new Date('2026-09-28T10:00:00Z')
    for (let i = 0; i < 8; i++) await throttle.recordFailure(keys, t0) // 8 failures: 8 s
    expect((await throttle.check(keys, t0)).retryAfterMs).toBe(8 * SECOND)
  })

  it('counts unknown and known accounts alike: the email key alone throttles every IP', async () => {
    const throttle = createLoginThrottle(memoryThrottleStore())
    const t0 = new Date('2026-09-28T10:00:00Z')
    for (let i = 0; i < 6; i++)
      await throttle.recordFailure(loginThrottleKeys('nobody@example.test', `198.51.100.${i + 1}`), t0)
    expect((await throttle.check(loginThrottleKeys('nobody@example.test', '203.0.113.50'), t0)).allowed).toBe(false)
  })

  it('resets the email key on success but keeps the IP key', async () => {
    const store = memoryThrottleStore()
    const throttle = createLoginThrottle(store)
    const t0 = new Date('2026-09-28T10:00:00Z')
    for (let i = 0; i < 7; i++) await throttle.recordFailure(keys, t0)
    await throttle.recordSuccess('Victim@Example.test')
    expect(store.rows.has(emailThrottleKey('victim@example.test'))).toBe(false)
    expect(store.rows.get(keys[1]!)?.failures).toBe(7)
    expect((await throttle.check(keys, t0)).allowed).toBe(false) // the IP still waits
    expect((await throttle.check(loginThrottleKeys('victim@example.test', '198.51.100.99'), t0)).allowed).toBe(true)
  })

  it('forgets failures older than 24 hours', async () => {
    const store = memoryThrottleStore()
    const throttle = createLoginThrottle(store)
    const t0 = new Date('2026-09-28T10:00:00Z')
    for (let i = 0; i < 10; i++) await throttle.recordFailure(keys, t0)
    const later = new Date(t0.getTime() + 25 * 3_600_000)
    await throttle.recordFailure(keys, later)
    expect(store.rows.get(keys[0]!)?.failures).toBe(1)
    expect((await throttle.check(keys, later)).allowed).toBe(true)
  })
})
