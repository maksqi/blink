import { describe, expect, it } from 'vitest'
import { SETTINGS_DEFAULTS } from '#shared/schemas/settings'
import { cleanupCutoffs, INVITE_GRACE_MS } from '../session/cleanup'
import { retentionCutoffs } from './retention'

const DAY = 24 * 3_600_000
const now = new Date('2026-06-15T03:23:00.000Z')

describe('retentionCutoffs (injected clock)', () => {
  it('uses the default 30 days for IPs and 180 days for the audit log', () => {
    const c = retentionCutoffs(now, SETTINGS_DEFAULTS)
    expect(now.getTime() - c.ipBefore.getTime()).toBe(30 * DAY)
    expect(now.getTime() - c.auditBefore.getTime()).toBe(180 * DAY)
  })

  it('follows the admin settings', () => {
    const c = retentionCutoffs(now, { 'privacy.ipRetentionDays': 1, 'audit.retentionDays': 365 })
    expect(c.ipBefore.toISOString()).toBe('2026-06-14T03:23:00.000Z')
    expect(c.auditBefore.toISOString()).toBe('2025-06-15T03:23:00.000Z')
  })
})

describe('cleanupCutoffs (injected clock)', () => {
  it('derives idle, invite and throttle cutoffs', () => {
    const c = cleanupCutoffs(now)
    expect(now.getTime() - c.idleBefore.getTime()).toBe(7 * DAY)
    expect(now.getTime() - c.inviteGraceBefore.getTime()).toBe(INVITE_GRACE_MS)
    expect(INVITE_GRACE_MS).toBe(30 * DAY)
    expect(now.getTime() - c.throttleStaleBefore.getTime()).toBe(DAY)
  })
})
