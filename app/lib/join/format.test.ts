import { describe, expect, it } from 'vitest'
import type { RoomInvite } from '#shared/schemas/rooms'
import {
  formatDuration,
  formatRelativeTime,
  inviteExpiryText,
  inviteState,
  inviteUsesText,
  meetingDuration,
} from './format'

const NOW = Date.parse('2026-10-03T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const INVITE: RoomInvite = {
  id: 'i1',
  label: null,
  token: 'token',
  expiresAt: null,
  maxUses: null,
  useCount: 0,
  revoked: false,
  createdAt: ago(DAY),
}

describe('formatRelativeTime', () => {
  it('reads like a person would say it', () => {
    expect(formatRelativeTime(null, NOW)).toBe('never')
    expect(formatRelativeTime('nonsense', NOW)).toBe('unknown')
    expect(formatRelativeTime(ago(10_000), NOW)).toBe('just now')
    expect(formatRelativeTime(ago(MIN), NOW)).toBe('1 minute ago')
    expect(formatRelativeTime(ago(5 * MIN), NOW)).toBe('5 minutes ago')
    expect(formatRelativeTime(ago(3 * HOUR), NOW)).toBe('3 hours ago')
    expect(formatRelativeTime(ago(2 * DAY), NOW)).toBe('2 days ago')
    expect(formatRelativeTime(ago(30 * DAY), NOW)).toMatch(/2026/)
    // A clock slightly behind the server is not "in the future".
    expect(formatRelativeTime(new Date(NOW + 5_000).toISOString(), NOW)).toBe('just now')
  })
})

describe('durations', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatDuration(45_000)).toBe('45 s')
    expect(formatDuration(12 * MIN)).toBe('12 min')
    expect(formatDuration(65 * MIN)).toBe('1 h 05 min')
    expect(formatDuration(-1)).toBe('0 s')
  })

  it('measures running meetings up to now', () => {
    expect(meetingDuration(ago(10 * MIN), null, NOW)).toBe('10 min')
    expect(meetingDuration(ago(2 * HOUR), ago(HOUR), NOW)).toBe('1 h 00 min')
  })
})

describe('invites', () => {
  it('knows the state of an invite', () => {
    expect(inviteState(INVITE, NOW)).toBe('active')
    expect(inviteState({ ...INVITE, revoked: true, expiresAt: ago(HOUR) }, NOW)).toBe('revoked')
    expect(inviteState({ ...INVITE, expiresAt: ago(1) }, NOW)).toBe('expired')
    expect(inviteState({ ...INVITE, maxUses: 3, useCount: 3 }, NOW)).toBe('used')
    expect(inviteState({ ...INVITE, maxUses: 3, useCount: 2 }, NOW)).toBe('active')
  })

  it('describes expiry and uses', () => {
    expect(inviteExpiryText(INVITE, NOW)).toBe('Never expires')
    expect(inviteExpiryText({ expiresAt: ago(-30 * MIN) }, NOW)).toBe('Expires in 30 minutes')
    expect(inviteExpiryText({ expiresAt: ago(-HOUR - 1) }, NOW)).toBe('Expires in 2 hours')
    expect(inviteExpiryText({ expiresAt: ago(-7 * DAY) }, NOW)).toBe('Expires in 7 days')
    expect(inviteExpiryText({ expiresAt: ago(2 * HOUR) }, NOW)).toBe('Expired 2 hours ago')
    expect(inviteUsesText({ useCount: 1, maxUses: null })).toBe('1 use')
    expect(inviteUsesText({ useCount: 0, maxUses: null })).toBe('0 uses')
    expect(inviteUsesText({ useCount: 2, maxUses: 5 })).toBe('2 of 5 uses')
  })
})
