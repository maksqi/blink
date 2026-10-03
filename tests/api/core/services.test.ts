/**
 * DB-backed server-core services, in-process against the test database: login backoff, settings, audit,
 * cleanup and retention (injected clocks; rows are unique per test).
 */
import { randomBytes } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { H3Error } from 'h3'
import { describe, expect, it } from 'vitest'
import {
  auditLog,
  callParticipants,
  emailTokens,
  guestSessions,
  loginThrottle,
  roomInvites,
  sessions,
  settings,
  userInvites,
} from '../../../server/database/schema'
import { audit } from '../../../server/services/audit/audit'
import { runRetention } from '../../../server/services/audit/retention'
import { runCleanup } from '../../../server/services/session/cleanup'
import {
  getSettings,
  getSystemFlag,
  invalidateSettingsCache,
  setSystemFlag,
  updateSettings,
} from '../../../server/services/settings/settings'
import { hashToken, randomToken } from '../../../server/utils/crypto'
import {
  checkLoginAllowed,
  clearLoginFailures,
  emailThrottleKey,
  loginThrottleKeys,
  recordLoginFailure,
} from '../../../server/utils/limiter'
import {
  createAdmin,
  createGuestSession,
  createInvite,
  createMeeting,
  createParticipant,
  createRoom,
  createRoomInvite,
  createSession,
  createUser,
  fakeEvent,
  testDb,
  uniqueEmail,
  uniqueIp,
  useServerEnvInProcess,
} from '../_harness'

useServerEnvInProcess()

const DAY = 24 * 3_600_000
const ago = (ms: number) => new Date(Date.now() - ms)

describe('login backoff (login_throttle)', () => {
  it('allows 5 failures, then waits 2^(n-5) s per key; success clears only the email key', async () => {
    const email = uniqueEmail()
    const keys = loginThrottleKeys(email, uniqueIp())
    const now = new Date()
    for (let i = 0; i < 5; i++) await recordLoginFailure(keys, now)
    expect(await checkLoginAllowed(keys, now)).toEqual({ allowed: true, retryAfterMs: 0 })

    await recordLoginFailure(keys, now)
    expect(await checkLoginAllowed(keys, now)).toEqual({ allowed: false, retryAfterMs: 2_000 })
    await recordLoginFailure(keys, now)
    expect(await checkLoginAllowed(keys, now)).toEqual({ allowed: false, retryAfterMs: 4_000 })
    expect((await checkLoginAllowed(keys, new Date(now.getTime() + 4_000))).allowed).toBe(true)

    await clearLoginFailures([emailThrottleKey(email)])
    expect((await checkLoginAllowed(keys, now)).allowed).toBe(false) // the IP key still counts
    await clearLoginFailures(keys)
    expect((await checkLoginAllowed(keys, now)).allowed).toBe(true)
  })

  it('counts parallel failures exactly and forgets failures older than 24 h', async () => {
    const key = emailThrottleKey(uniqueEmail())
    await Promise.all(Array.from({ length: 8 }, () => recordLoginFailure([key])))
    const [row] = await testDb().select().from(loginThrottle).where(eq(loginThrottle.key, key))
    expect(row!.failures).toBe(8)
    await testDb().update(loginThrottle).set({ updatedAt: ago(25 * 3_600_000) }).where(eq(loginThrottle.key, key))
    await recordLoginFailure([key])
    const [reset] = await testDb().select().from(loginThrottle).where(eq(loginThrottle.key, key))
    expect(reset!.failures).toBe(1)
    await clearLoginFailures([key])
  })
})

describe('settings service', () => {
  it('writes only the sent keys, invalidates the cache and records the actor', async () => {
    const admin = await createAdmin()
    try {
      const before = await getSettings()
      const keysBefore = (await testDb().select({ key: settings.key }).from(settings)).map((r) => r.key)
      const next = await updateSettings({ 'limits.maxRoomsPerUser': 7 }, admin.id)
      expect(next['limits.maxRoomsPerUser']).toBe(7)
      expect(next['guests.allowed']).toBe(before['guests.allowed'])
      expect((await getSettings())['limits.maxRoomsPerUser']).toBe(7)
      const [row] = await testDb().select().from(settings).where(eq(settings.key, 'limits.maxRoomsPerUser'))
      expect(row).toMatchObject({ value: 7, updatedBy: admin.id })
      const rows = await testDb().select({ key: settings.key }).from(settings)
      expect(rows.map((r) => r.key).sort()).toEqual([...new Set([...keysBefore, 'limits.maxRoomsPerUser'])].sort())
    } finally {
      await testDb().delete(settings).where(eq(settings.key, 'limits.maxRoomsPerUser'))
      invalidateSettingsCache()
    }
  })

  it('rejects invalid patches with VALIDATION_FAILED', async () => {
    for (const patch of [{ 'limits.maxRoomsPerUser': 0 }, { 'system.bootstrapDone': true }, { unknown: 1 }]) {
      const error = await updateSettings(patch, null).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(H3Error)
      expect((error as H3Error).data).toMatchObject({ code: 'VALIDATION_FAILED' })
    }
  })

  it('keeps system flags out of getSettings', async () => {
    const key = `system.test_${randomBytes(4).toString('hex')}` as const
    try {
      await setSystemFlag(key, { on: true })
      expect(await getSystemFlag(key)).toEqual({ on: true })
      invalidateSettingsCache()
      expect(JSON.stringify(await getSettings())).not.toContain(key)
    } finally {
      await testDb().delete(settings).where(eq(settings.key, key))
    }
  })
})

describe('audit', () => {
  it('records the action, the client IP, the signed-in actor and redacted details', async () => {
    const user = await createUser()
    const session = await createSession(user.id)
    const targetId = randomToken(8)
    await audit(fakeEvent({ cookie: session.cookie, ip: '203.0.113.77' }), {
      action: 'test.audit_write',
      targetType: 'thing',
      targetId,
      details: { password: 'hunter2', note: 'ok' },
    })
    await audit(null, { action: 'test.audit_write', targetType: 'thing', targetId, actorUserId: null })
    const rows = await testDb().select().from(auditLog).where(eq(auditLog.targetId, targetId))
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.actorUserId === user.id)).toMatchObject({
      ip: '203.0.113.77',
      details: { password: '[redacted]', note: 'ok' },
    })
    expect(rows.find((r) => r.actorUserId === null)).toMatchObject({ ip: null, details: null })
  })
})

describe('maintenance tasks', () => {
  it('cleanup deletes expired and stale rows and keeps live ones', async () => {
    const user = await createUser()
    const expired = await createSession(user.id, { expiresAt: ago(1_000) })
    const idle = await createSession(user.id, { createdAt: ago(9 * DAY), lastSeenAt: ago(8 * DAY) })
    const live = await createSession(user.id)
    const room = await createRoom(user)
    const oldGuest = await createGuestSession(room, { expiresAt: ago(1_000) })
    const liveGuest = await createGuestSession(room)
    const oldInvite = await createInvite({ expiresAt: ago(31 * DAY) })
    const freshInvite = await createInvite()
    const revokedRoomInvite = await createRoomInvite(room)
    await testDb().update(roomInvites).set({ revokedAt: ago(31 * DAY) }).where(eq(roomInvites.id, revokedRoomInvite.id))
    const liveRoomInvite = await createRoomInvite(room, { expiresAt: null })
    const [usedToken] = await testDb()
      .insert(emailTokens)
      .values({ userId: user.id, purpose: 'verify_email', tokenHash: hashToken(randomToken()), expiresAt: new Date(Date.now() + DAY), usedAt: ago(1_000) })
      .returning()
    const staleKey = emailThrottleKey(uniqueEmail())
    await testDb().insert(loginThrottle).values({ key: staleKey, failures: 3, updatedAt: ago(25 * 3_600_000) })

    const result = await runCleanup()
    expect(result.sessions).toBeGreaterThanOrEqual(2)

    const remainingSessions = await testDb()
      .select({ id: sessions.id })
      .from(sessions)
      .where(inArray(sessions.id, [expired.id, idle.id, live.id]))
    expect(remainingSessions.map((s) => s.id)).toEqual([live.id])
    const guests = await testDb().select({ id: guestSessions.id }).from(guestSessions).where(inArray(guestSessions.id, [oldGuest.id, liveGuest.id]))
    expect(guests.map((g) => g.id)).toEqual([liveGuest.id])
    const invites = await testDb().select({ id: userInvites.id }).from(userInvites).where(inArray(userInvites.id, [oldInvite.id, freshInvite.id]))
    expect(invites.map((i) => i.id)).toEqual([freshInvite.id])
    const roomInviteRows = await testDb()
      .select({ id: roomInvites.id })
      .from(roomInvites)
      .where(inArray(roomInvites.id, [revokedRoomInvite.id, liveRoomInvite.id]))
    expect(roomInviteRows.map((i) => i.id)).toEqual([liveRoomInvite.id])
    expect(await testDb().select().from(emailTokens).where(eq(emailTokens.id, usedToken!.id))).toHaveLength(0)
    expect(await testDb().select().from(loginThrottle).where(eq(loginThrottle.key, staleKey))).toHaveLength(0)
  })

  it('retention erases old IP addresses and deletes old audit entries', async () => {
    const user = await createUser()
    const targetId = randomToken(8)
    const [oldAudit, agedAudit, newAudit] = await testDb()
      .insert(auditLog)
      .values([
        { action: 'test.retention', targetId, ip: '203.0.113.1', at: ago(200 * DAY) },
        { action: 'test.retention', targetId, ip: '203.0.113.2', at: ago(40 * DAY) },
        { action: 'test.retention', targetId, ip: '203.0.113.3', at: ago(DAY) },
      ])
      .returning()
    const oldSession = await createSession(user.id, { createdAt: ago(40 * DAY), lastSeenAt: new Date(), expiresAt: new Date(Date.now() + DAY), ip: '203.0.113.4' })
    const room = await createRoom(user)
    const meeting = await createMeeting(room)
    const participant = await createParticipant({ room, meeting, userId: user.id })
    await testDb().update(callParticipants).set({ ip: '203.0.113.5', createdAt: ago(40 * DAY) }).where(eq(callParticipants.id, participant.id))

    await runRetention(new Date(), testDb(), { 'privacy.ipRetentionDays': 30, 'audit.retentionDays': 180 })

    const auditRows = await testDb().select().from(auditLog).where(eq(auditLog.targetId, targetId))
    expect(auditRows.map((r) => r.id).sort()).toEqual([agedAudit!.id, newAudit!.id].sort())
    expect(auditRows.find((r) => r.id === agedAudit!.id)!.ip).toBeNull()
    expect(auditRows.find((r) => r.id === newAudit!.id)!.ip).toBe('203.0.113.3')
    expect(oldAudit).toBeDefined()
    const [sessionRow] = await testDb().select().from(sessions).where(eq(sessions.id, oldSession.id))
    expect(sessionRow!.ip).toBeNull()
    const [participantRow] = await testDb().select().from(callParticipants).where(eq(callParticipants.id, participant.id))
    expect(participantRow!.ip).toBeNull()
  })
})
