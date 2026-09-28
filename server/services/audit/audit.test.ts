import { describe, expect, it } from 'vitest'
import { randomToken } from '../../utils/crypto'
import { AUDIT_DETAILS_MAX_BYTES, buildAuditRow, sanitizeDetails } from './audit'

const now = new Date('2026-05-01T10:00:00.000Z')

describe('buildAuditRow', () => {
  it('builds the row with the request context', () => {
    expect(
      buildAuditRow(
        { action: 'admin.disable_user', targetType: 'user', targetId: 'u2', details: { reason: 'left' } },
        { ip: '203.0.113.4', actorUserId: 'u1', now },
      ),
    ).toEqual({
      at: now,
      action: 'admin.disable_user',
      actorUserId: 'u1',
      actorParticipantId: null,
      ip: '203.0.113.4',
      targetType: 'user',
      targetId: 'u2',
      details: { reason: 'left' },
    })
  })

  it('lets callers override or clear the actor', () => {
    const context = { ip: null, actorUserId: 'from-session', now }
    expect(buildAuditRow({ action: 'auth.login_failed', actorUserId: null }, context).actorUserId).toBeNull()
    expect(buildAuditRow({ action: 'auth.login_failed', actorUserId: 'u9' }, context).actorUserId).toBe('u9')
    expect(buildAuditRow({ action: 'call.remove', actorParticipantId: 'p1' }, context).actorParticipantId).toBe('p1')
  })

  it.each(['login', 'Admin.update', 'admin.', '.verb', 'admin.update settings', 'admin/update'])(
    'rejects the action name %s',
    (action) => {
      expect(() => buildAuditRow({ action }, { ip: null, actorUserId: null, now })).toThrow(/Invalid audit action/)
    },
  )

  it.each(['system.bootstrap', 'auth.password_changed', 'admin.update_settings', 'recording.admin_download', 'a.b.c'])(
    'accepts the action name %s',
    (action) => {
      expect(buildAuditRow({ action }, { ip: null, actorUserId: null, now }).action).toBe(action)
    },
  )
})

describe('sanitizeDetails', () => {
  it('removes secrets and token-like strings', () => {
    const token = randomToken()
    expect(sanitizeDetails({ email: 'a@example.test', password: 'x', note: `token ${token}`, nested: { proof: 'p' } })).toEqual({
      email: 'a@example.test',
      password: '[redacted]',
      note: 'token [redacted]',
      nested: { proof: '[redacted]' },
    })
    expect(sanitizeDetails(undefined)).toBeNull()
    expect(sanitizeDetails(null)).toBeNull()
  })

  it('caps oversized details', () => {
    const big = sanitizeDetails({ blob: 'x'.repeat(AUDIT_DETAILS_MAX_BYTES) })
    expect(big).toMatchObject({ truncated: true })
  })
})
