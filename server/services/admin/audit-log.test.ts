import { describe, expect, it } from 'vitest'
import { auditQuerySchema } from '#shared/schemas/admin'
import { auditFilter, toAuditEntry, type AuditRow } from './audit-log'

const ACTOR = '01890000-0000-7000-8000-0000000000aa'

describe('auditFilter', () => {
  it('has no conditions for an empty query', () => {
    expect(auditFilter(auditQuerySchema.parse({}))).toEqual({ action: null, actorUserId: null, target: null })
  })

  it('matches a dotted action exactly and a bare domain as a prefix', () => {
    expect(auditFilter({ action: 'admin.user_created' }).action).toEqual({ kind: 'exact', value: 'admin.user_created' })
    expect(auditFilter({ action: ' Admin ' }).action).toEqual({ kind: 'domain', value: 'admin.%' })
    // LIKE wildcards in the input stay literal.
    expect(auditFilter({ action: 'ad_m%' }).action).toEqual({ kind: 'domain', value: 'ad\\_m\\%.%' })
  })

  it('searches the target with an escaped substring pattern', () => {
    expect(auditFilter({ q: ' user ' }).target).toBe('%user%')
    expect(auditFilter({ q: '50%_off\\' }).target).toBe('%50\\%\\_off\\\\%')
  })

  it('keeps the actor and validates it as a uuid', () => {
    expect(auditFilter(auditQuerySchema.parse({ actorUserId: ACTOR })).actorUserId).toBe(ACTOR)
    expect(auditQuerySchema.safeParse({ actorUserId: 'nope' }).success).toBe(false)
    expect(auditQuerySchema.safeParse({ action: 'a'.repeat(81) }).success).toBe(false)
  })
})

describe('toAuditEntry', () => {
  const base: AuditRow = {
    id: '01890000-0000-7000-8000-000000000001',
    at: new Date('2026-09-03T12:00:00.000Z'),
    actorUserId: ACTOR,
    actorParticipantId: null,
    actorUserName: 'Ada',
    actorParticipantName: null,
    ip: '203.0.113.7',
    action: 'admin.user_updated',
    targetType: 'user',
    targetId: '01890000-0000-7000-8000-0000000000bb',
    details: { fields: ['role'] },
  }

  it('maps a row to the documented shape', () => {
    expect(toAuditEntry(base)).toEqual({
      id: base.id,
      at: '2026-09-03T12:00:00.000Z',
      actor: { userId: ACTOR, displayName: 'Ada', participantId: null },
      ip: '203.0.113.7',
      action: 'admin.user_updated',
      targetType: 'user',
      targetId: base.targetId,
      details: { fields: ['role'] },
    })
  })

  it('names participant actors and leaves deleted users nameless', () => {
    const participant = toAuditEntry({
      ...base,
      actorUserId: null,
      actorUserName: null,
      actorParticipantId: '01890000-0000-7000-8000-0000000000cc',
      actorParticipantName: 'Guest Grace',
    })
    expect(participant.actor).toEqual({
      userId: null,
      displayName: 'Guest Grace',
      participantId: '01890000-0000-7000-8000-0000000000cc',
    })
    expect(toAuditEntry({ ...base, actorUserId: null, actorUserName: null }).actor.displayName).toBeNull()
  })

  it('only returns object details', () => {
    expect(toAuditEntry({ ...base, details: null }).details).toBeNull()
    expect(toAuditEntry({ ...base, details: ['x'] }).details).toBeNull()
    expect(toAuditEntry({ ...base, details: 'text' }).details).toBeNull()
  })
})
