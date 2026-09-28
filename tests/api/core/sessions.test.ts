/**
 * Session service, request auth and resolveCaller, in-process against the test database (injected clocks).
 */
import { eq } from 'drizzle-orm'
import { H3Error } from 'h3'
import { describe, expect, it } from 'vitest'
import { meetings, sessions } from '../../../server/database/schema'
import * as sessionService from '../../../server/services/session/sessions'
import { getAuth, requireAdmin, requireUser, resolveCaller } from '../../../server/utils/auth'
import { hashToken } from '../../../server/utils/crypto'
import { subscribeTo } from '../../../server/utils/event-bus'
import {
  createAdmin,
  createGuestSession,
  createMeeting,
  createParticipant,
  createRoom,
  createUser,
  fakeEvent,
  testDb,
  useServerEnvInProcess,
} from '../_harness'

useServerEnvInProcess()

const DAY = 24 * 3_600_000
const cookieFor = (token: string) => `blinq_session=${token}`

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
  } catch (error) {
    if (error instanceof H3Error) return (error.data as { code?: string }).code
    throw error
  }
  return undefined
}

async function sessionRow(token: string) {
  const [row] = await testDb().select().from(sessions).where(eq(sessions.id, hashToken(token)))
  return row
}

describe('session service', () => {
  it('stores only the token hash and validates with the user snapshot', async () => {
    const user = await createUser()
    const t0 = new Date()
    const token = await sessionService.createSession(user.id, { ip: '203.0.113.5', userAgent: 'x'.repeat(600) }, t0)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const row = await sessionRow(token)
    expect(row).toMatchObject({ userId: user.id, ip: '203.0.113.5', authMethod: 'password' })
    expect(row!.userAgent).toHaveLength(512)
    expect(row!.expiresAt.getTime() - t0.getTime()).toBe(30 * DAY)
    const valid = await sessionService.validateSession(token, { now: t0 })
    expect(valid?.user).toEqual({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: 'user',
      mustChangePassword: false,
      emailVerified: true,
    })
    expect(await sessionService.validateSession('x'.repeat(43))).toBeNull()
    expect(await sessionService.validateSession('short')).toBeNull()
  })

  it('writes last_seen_at at most once a minute', async () => {
    const user = await createUser()
    const t0 = new Date(Date.now() - 10 * 60_000)
    const token = await sessionService.createSession(user.id, {}, t0)
    await sessionService.validateSession(token, { now: new Date(t0.getTime() + 59_000) })
    expect((await sessionRow(token))!.lastSeenAt.getTime()).toBe(t0.getTime())
    const touchedAt = new Date(t0.getTime() + 61_000)
    await sessionService.validateSession(token, { now: touchedAt })
    expect((await sessionRow(token))!.lastSeenAt.getTime()).toBe(touchedAt.getTime())
    await sessionService.validateSession(token, { now: new Date(t0.getTime() + 100_000) })
    expect((await sessionRow(token))!.lastSeenAt.getTime()).toBe(touchedAt.getTime())
  })

  it('expires after 7 idle days and deletes the row', async () => {
    const user = await createUser()
    const t0 = new Date()
    const token = await sessionService.createSession(user.id, {}, t0)
    expect(await sessionService.validateSession(token, { now: new Date(t0.getTime() + 7 * DAY - 1_000) })).not.toBeNull()
    // The cache holds the entry for 30 s; move far enough that it reloads.
    expect(await sessionService.validateSession(token, { now: new Date(t0.getTime() + 14 * DAY) })).toBeNull()
    expect(await sessionRow(token)).toBeUndefined()
  })

  it('rejects disabled users without deleting their sessions', async () => {
    const user = await createUser({ disabled: true })
    const token = await sessionService.createSession(user.id)
    expect(await sessionService.validateSession(token)).toBeNull()
    expect(await sessionRow(token)).toBeDefined()
  })

  it('rotates: the old token stops working at once, the new one keeps the metadata', async () => {
    const user = await createUser()
    const token = await sessionService.createSession(user.id, { ip: '198.51.100.7', userAgent: 'agent' })
    await sessionService.validateSession(token)
    const rotated = await sessionService.rotateSession(hashToken(token))
    expect(rotated).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await sessionService.validateSession(token)).toBeNull()
    expect((await sessionService.validateSession(rotated!))?.session).toMatchObject({ ip: '198.51.100.7', userAgent: 'agent' })
    expect(await sessionService.rotateSession(hashToken(token))).toBeNull()
  })

  it('revokes one session or all of a user, publishing user.revoked only for all', async () => {
    const user = await createUser()
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => sessionService.createSession(user.id)))
    for (const token of [a!, b!, c!]) await sessionService.validateSession(token)
    const revoked: string[] = []
    const off = subscribeTo('user.revoked', (e) => revoked.push(e.userId))
    try {
      expect(await sessionService.revokeSession(hashToken(a!))).toBe(true)
      expect(await sessionService.revokeSession(hashToken(a!))).toBe(false)
      expect(await sessionService.validateSession(a!)).toBeNull()
      expect(await sessionService.revokeAllForUser(user.id, { exceptSessionId: hashToken(b!) })).toBe(1)
      expect(await sessionService.validateSession(b!)).not.toBeNull()
      expect(await sessionService.validateSession(c!)).toBeNull()
      expect(revoked).toEqual([])
      expect(await sessionService.revokeAllForUser(user.id)).toBe(1)
      expect(await sessionService.validateSession(b!)).toBeNull()
      expect(revoked).toEqual([user.id])
    } finally {
      off()
    }
  })

  it('lists active sessions, most recent first', async () => {
    const user = await createUser()
    const now = new Date()
    const old = await sessionService.createSession(user.id, {}, new Date(now.getTime() - 2 * DAY))
    const fresh = await sessionService.createSession(user.id, {}, now)
    await sessionService.createSession(user.id, {}, new Date(now.getTime() - 8 * DAY)) // idle
    const list = await sessionService.listSessions(user.id, now)
    expect(list.map((s) => s.id)).toEqual([hashToken(fresh), hashToken(old)])
  })
})

describe('request auth', () => {
  it('resolves the session once per request and enforces roles', async () => {
    const user = await createUser()
    const admin = await createAdmin()
    const userEvent = fakeEvent({ cookie: cookieFor(await sessionService.createSession(user.id)) })
    expect(getAuth(userEvent)).toBe(getAuth(userEvent))
    expect((await requireUser(userEvent)).id).toBe(user.id)
    expect(await codeOf(requireAdmin(userEvent))).toBe('FORBIDDEN')
    const adminEvent = fakeEvent({ cookie: cookieFor(await sessionService.createSession(admin.id)) })
    expect((await requireAdmin(adminEvent)).role).toBe('admin')
    expect(await codeOf(requireUser(fakeEvent()))).toBe('UNAUTHENTICATED')
    expect(await codeOf(requireAdmin(fakeEvent()))).toBe('UNAUTHENTICATED')
  })

  it('clears an invalid session cookie', async () => {
    const event = fakeEvent({ cookie: cookieFor('A'.repeat(43)) })
    expect((await getAuth(event)).user).toBeNull()
    expect(String(event.node.res.getHeader('set-cookie'))).toContain('Max-Age=0')
  })
})

describe('resolveCaller', () => {
  async function liveRoom() {
    const host = await createUser()
    const room = await createRoom(host)
    const meeting = await createMeeting(room)
    return { host, room, meeting }
  }

  it("returns the signed-in user's own active row", async () => {
    const { room, meeting } = await liveRoom()
    const user = await createUser()
    const row = await createParticipant({ room, meeting, userId: user.id, status: 'joined' })
    const event = fakeEvent({ cookie: cookieFor(await sessionService.createSession(user.id)) })
    expect((await resolveCaller(event, room.id)).id).toBe(row.id)
  })

  it('prefers the matching clientId, else the most recently joined row', async () => {
    const { room, meeting } = await liveRoom()
    const user = await createUser()
    const first = await createParticipant({ room, meeting, userId: user.id, status: 'joined' })
    await new Promise((r) => setTimeout(r, 5))
    const second = await createParticipant({ room, meeting, userId: user.id, status: 'admitted' })
    const cookie = cookieFor(await sessionService.createSession(user.id))
    expect((await resolveCaller(fakeEvent({ cookie }), room.id, { clientId: first.clientId })).id).toBe(first.id)
    expect((await resolveCaller(fakeEvent({ cookie }), room.id)).id).toBe(second.id)
  })

  it('resolves guests through the per-room guest cookie', async () => {
    const { room, meeting } = await liveRoom()
    const guest = await createGuestSession(room)
    const row = await createParticipant({ room, meeting, guestSessionId: guest.id, status: 'joined' })
    expect((await resolveCaller(fakeEvent({ cookie: guest.cookie }), room.id)).id).toBe(row.id)
    const expired = await createGuestSession(room, { expiresAt: new Date(Date.now() - 1_000) })
    await createParticipant({ room, meeting, guestSessionId: expired.id, status: 'joined' })
    expect(await codeOf(resolveCaller(fakeEvent({ cookie: expired.cookie }), room.id))).toBe('CALL_NOT_PARTICIPANT')
  })

  it('refuses waiting, removed, ended and foreign rows and malformed room ids', async () => {
    const { room, meeting } = await liveRoom()
    const other = await liveRoom()
    const ended = await liveRoom()
    await testDb().update(meetings).set({ endedAt: new Date() }).where(eq(meetings.id, ended.meeting.id))
    const user = await createUser()
    await createParticipant({ room, meeting, userId: user.id, status: 'waiting' })
    await createParticipant({ room, meeting, userId: user.id, status: 'removed' })
    await createParticipant({ room: other.room, meeting: other.meeting, userId: user.id, status: 'joined' })
    await createParticipant({ room: ended.room, meeting: ended.meeting, userId: user.id, status: 'joined' })
    const cookie = cookieFor(await sessionService.createSession(user.id))
    for (const roomId of [room.id, ended.room.id, 'not-a-uuid']) {
      expect(await codeOf(resolveCaller(fakeEvent({ cookie }), roomId))).toBe('CALL_NOT_PARTICIPANT')
    }
    expect(await codeOf(resolveCaller(fakeEvent(), other.room.id))).toBe('CALL_NOT_PARTICIPANT')
  })
})
