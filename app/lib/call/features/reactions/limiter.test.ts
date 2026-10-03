import { describe, expect, it } from 'vitest'
import { SEND_LIMIT, SlidingWindowLimiter } from './limiter'

describe('SlidingWindowLimiter', () => {
  it('allows up to the limit per window and frees slots as the window slides', () => {
    const limiter = new SlidingWindowLimiter(SEND_LIMIT)
    expect([0, 100, 200, 300].map((t) => limiter.allow('me', t))).toEqual([true, true, true, false])
    expect(limiter.remaining('me', 300)).toBe(0)
    // The first hit (t=0) leaves the window after 1 s.
    expect(limiter.allow('me', 1_000)).toBe(true)
    expect(limiter.allow('me', 1_050)).toBe(false)
    expect(limiter.allow('me', 1_250)).toBe(true)
  })

  it('counts every key separately', () => {
    const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 1_000 })
    expect(limiter.allow('a', 0)).toBe(true)
    expect(limiter.allow('b', 0)).toBe(true)
    expect(limiter.allow('a', 10)).toBe(false)
  })

  it('does not count rejected events', () => {
    const limiter = new SlidingWindowLimiter({ limit: 2, windowMs: 1_000 })
    limiter.allow('a', 0)
    limiter.allow('a', 0)
    for (let t = 1; t < 999; t += 50) expect(limiter.allow('a', t)).toBe(false)
    expect(limiter.allow('a', 1_001)).toBe(true)
  })

  it('caps the number of remembered keys', () => {
    const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 10_000, maxKeys: 2 })
    limiter.allow('a', 0)
    limiter.allow('b', 0)
    limiter.allow('c', 0)
    // "a" was forgotten, so it may send again.
    expect(limiter.allow('a', 1)).toBe(true)
    expect(limiter.allow('c', 1)).toBe(false)
  })

  it('resets', () => {
    const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 1_000 })
    limiter.allow('a', 0)
    limiter.reset()
    expect(limiter.allow('a', 1)).toBe(true)
  })
})
