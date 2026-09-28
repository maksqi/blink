/**
 * Own sessions: list with the current marker, revoke own only, absolute (30 d) and idle (7 d) expiry by aged rows,
 * revoked sessions rejected on the next request, logout.
 */
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { sessions } from '../../../server/database/schema'
import { normalizeIp } from '../../../server/utils/client-ip'
import { createClient, createSession, createUser, expectApiError, loginAs, testDb } from '../_harness'
import { auditRows, sessionCookie, signIn } from './support'

const DAY = 24 * 3_600_000

async function sessionExists(id: string): Promise<boolean> {
  return (await testDb().select({ id: sessions.id }).from(sessions).where(eq(sessions.id, id))).length > 0
}

describe('GET /api/auth/sessions', () => {
  it('lists the own active sessions, most recent first, marking this one', async () => {
    const user = await createUser()
    const other = await createUser()
    const older = await createSession(user.id, { createdAt: new Date(Date.now() - 2 * DAY), ip: '203.0.113.7' })
    await createSession(user.id, {
      createdAt: new Date(Date.now() - 9 * DAY),
      lastSeenAt: new Date(Date.now() - 8 * DAY),
    }) // idle
    await createSession(other.id)
    const api = createClient()
    await signIn(api, user.email, user.password)

    const res = await api.get('/api/auth/sessions')
    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(2)
    const [current, previous] = res.body.items
    expect(current).toMatchObject({ current: true, ip: normalizeIp(api.ip) })
    expect(previous).toMatchObject({ id: older.id, current: false, ip: '203.0.113.7', userAgent: 'api-test' })
    expect(Date.parse(current.lastSeenAt)).toBeGreaterThan(Date.parse(previous.lastSeenAt))
    for (const item of res.body.items)
      expect(Object.keys(item).sort()).toEqual(['createdAt', 'current', 'id', 'ip', 'lastSeenAt', 'userAgent'])
  })

  it('needs a session', async () => {
    expectApiError(await createClient().get('/api/auth/sessions'), 401, 'UNAUTHENTICATED')
    expectApiError(await createClient().delete(`/api/auth/sessions/${'a'.repeat(64)}`), 401, 'UNAUTHENTICATED')
  })
})

describe('DELETE /api/auth/sessions/:id', () => {
  it('revokes another own session; it is rejected on its next request', async () => {
    const user = await createUser()
    const api = await loginAs(user)
    const phone = await loginAs(user)
    expect((await phone.get('/api/auth/me')).body.user.id).toBe(user.id) // cached by the server now
    const res = await api.delete(`/api/auth/sessions/${phone.session!.id}`)
    expect(res.status).toBe(204)
    expect(await sessionExists(phone.session!.id)).toBe(false)
    expect((await phone.get('/api/auth/me')).body.user).toBeNull()
    expectApiError(await phone.get('/api/auth/sessions'), 401, 'UNAUTHENTICATED')
    expect((await api.get('/api/auth/me')).body.user.id).toBe(user.id)
    expect(await auditRows({ action: 'auth.session_revoked', targetId: phone.session!.id })).toHaveLength(1)
  })

  it("answers 404 for another user's session and leaves it alone", async () => {
    const [mine, theirs] = [await loginAs(await createUser()), await loginAs(await createUser())]
    expectApiError(await mine.delete(`/api/auth/sessions/${theirs.session!.id}`), 404, 'NOT_FOUND')
    expect((await theirs.get('/api/auth/me')).body.user).not.toBeNull()
    expectApiError(await mine.delete('/api/auth/sessions/not-a-session-id'), 404, 'NOT_FOUND')
  })

  it('revoking the current session signs this browser out and clears the cookie', async () => {
    const api = await loginAs(await createUser())
    const res = await api.delete(`/api/auth/sessions/${api.session!.id}`)
    expect(res.status).toBe(204)
    expect(sessionCookie(res)?.value).toBe('')
    expect((await api.get('/api/auth/me')).body.user).toBeNull()
  })
})

describe('session lifetime', () => {
  it('rejects a session past its absolute expiry (30 d) and clears the cookie', async () => {
    const user = await createUser()
    const session = await createSession(user.id, {
      createdAt: new Date(Date.now() - 30 * DAY - 60_000),
      lastSeenAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() - 60_000),
    })
    const api = createClient().setCookie(session.cookieName, session.token)
    const res = await api.get('/api/auth/me')
    expect(res.body.user).toBeNull()
    expect(sessionCookie(res)?.value).toBe('')
    expect(await sessionExists(session.id)).toBe(false)
  })

  it('rejects a session idle for 7 days', async () => {
    const user = await createUser()
    const session = await createSession(user.id, {
      createdAt: new Date(Date.now() - 8 * DAY),
      lastSeenAt: new Date(Date.now() - 7 * DAY - 60_000),
    })
    const api = createClient().setCookie(session.cookieName, session.token)
    expect((await api.get('/api/auth/me')).body.user).toBeNull()
    expectApiError(await api.get('/api/auth/sessions'), 401, 'UNAUTHENTICATED')
  })

  it('accepts a session inside both limits and records the activity', async () => {
    const user = await createUser()
    const session = await createSession(user.id, {
      createdAt: new Date(Date.now() - 29 * DAY),
      lastSeenAt: new Date(Date.now() - 6 * DAY),
      expiresAt: new Date(Date.now() + DAY),
    })
    const api = createClient().setCookie(session.cookieName, session.token)
    expect((await api.get('/api/auth/me')).body.user.id).toBe(user.id)
    const [row] = await testDb().select().from(sessions).where(eq(sessions.id, session.id))
    expect(Date.now() - row!.lastSeenAt.getTime()).toBeLessThan(60_000)
  })
})

describe('POST /api/auth/logout', () => {
  it('revokes the session (204), clears the cookie and audits; a second logout is 401', async () => {
    const user = await createUser()
    const api = await loginAs(user)
    const res = await api.post('/api/auth/logout')
    expect(res.status).toBe(204)
    expect(res.text).toBe('')
    expect(await sessionExists(api.session!.id)).toBe(false)
    expect((await auditRows({ action: 'auth.logout', targetId: user.id })).length).toBe(1)
    // The old token no longer works, even when replayed.
    const replay = createClient().setCookie('blinq_session', api.session!.token)
    expect((await replay.get('/api/auth/me')).body.user).toBeNull()
    expectApiError(await api.post('/api/auth/logout'), 401, 'UNAUTHENTICATED')
  })
})
