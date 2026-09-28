import { describe, expect, it } from 'vitest'
import { inviteExpiresAt, inviteState, inviteUsableForInfo } from './policy'

const NOW = new Date('2026-09-28T12:00:00.000Z')
const HOUR = 3_600_000
const base = { revokedAt: null, expiresAt: null, maxUses: null, useCount: 0 }

describe('inviteExpiresAt', () => {
  it.each([
    ['1h', HOUR],
    ['24h', 24 * HOUR],
    ['7d', 7 * 24 * HOUR],
  ] as const)('%s', (expiresIn, ms) => {
    expect(inviteExpiresAt(expiresIn, NOW)?.getTime()).toBe(NOW.getTime() + ms)
  })

  it('never → null', () => {
    expect(inviteExpiresAt('never', NOW)).toBeNull()
  })
})

describe('inviteState', () => {
  it('is valid without limits', () => {
    expect(inviteState(base, NOW)).toBe('valid')
  })

  it('expires at the exact expiry time', () => {
    expect(inviteState({ ...base, expiresAt: new Date(NOW.getTime() + 1) }, NOW)).toBe('valid')
    expect(inviteState({ ...base, expiresAt: NOW }, NOW)).toBe('expired')
  })

  it('is exhausted when use_count reached max_uses', () => {
    expect(inviteState({ ...base, maxUses: 3, useCount: 2 }, NOW)).toBe('valid')
    expect(inviteState({ ...base, maxUses: 3, useCount: 3 }, NOW)).toBe('exhausted')
  })

  it('reports revocation first, then expiry', () => {
    const all = { revokedAt: NOW, expiresAt: new Date(0), maxUses: 1, useCount: 1 }
    expect(inviteState(all, NOW)).toBe('revoked')
    expect(inviteState({ ...all, revokedAt: null }, NOW)).toBe('expired')
  })

  it('lets info accept exhausted invites only', () => {
    expect(inviteUsableForInfo('valid')).toBe(true)
    expect(inviteUsableForInfo('exhausted')).toBe(true)
    expect(inviteUsableForInfo('expired')).toBe(false)
    expect(inviteUsableForInfo('revoked')).toBe(false)
    expect(inviteUsableForInfo(null)).toBe(false)
  })
})
