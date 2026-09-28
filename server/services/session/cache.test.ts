import { describe, expect, it } from 'vitest'
import { createSessionCache } from './cache'

const t0 = new Date('2026-03-01T00:00:00.000Z')
const later = (ms: number) => new Date(t0.getTime() + ms)
const entry = (id: string, userId: string, extra = 0) => ({ session: { id, userId }, extra })

describe('createSessionCache', () => {
  it('serves entries for at most ttlMs after loading; hits and updates do not extend them', () => {
    const cache = createSessionCache<ReturnType<typeof entry>>({ ttlMs: 30_000 })
    cache.set('s1', entry('s1', 'u1'), t0)
    expect(cache.get('s1', later(29_999))?.session.id).toBe('s1')
    cache.update('s1', entry('s1', 'u1', 5))
    expect(cache.get('s1', later(29_999))?.extra).toBe(5)
    expect(cache.get('s1', later(30_000))).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it('evicts one session, all sessions of a user, or everything', () => {
    const cache = createSessionCache<ReturnType<typeof entry>>({ ttlMs: 30_000 })
    cache.set('a', entry('a', 'u1'), t0)
    cache.set('b', entry('b', 'u1'), t0)
    cache.set('c', entry('c', 'u2'), t0)
    cache.delete('a')
    expect(cache.get('a', t0)).toBeUndefined()
    cache.deleteUser('u1')
    expect(cache.get('b', t0)).toBeUndefined()
    expect(cache.get('c', t0)).toBeDefined()
    cache.clear()
    expect(cache.size).toBe(0)
  })

  it('drops the oldest entries beyond maxEntries', () => {
    const cache = createSessionCache<ReturnType<typeof entry>>({ ttlMs: 30_000, maxEntries: 2 })
    cache.set('a', entry('a', 'u'), t0)
    cache.set('b', entry('b', 'u'), t0)
    cache.set('c', entry('c', 'u'), t0)
    expect(cache.size).toBe(2)
    expect(cache.get('a', t0)).toBeUndefined()
    expect(cache.get('c', t0)).toBeDefined()
  })

  it('ignores updates for entries that are not cached', () => {
    const cache = createSessionCache<ReturnType<typeof entry>>({ ttlMs: 1_000 })
    cache.update('missing', entry('missing', 'u'))
    expect(cache.size).toBe(0)
  })
})
