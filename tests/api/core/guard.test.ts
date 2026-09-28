/**
 * Forced password change guard and session resolution. Other routes are still stubs (501) or, once implemented,
 * answer with their own statuses; what matters here is whether the guard answered.
 */
import { describe, expect, it } from 'vitest'
import { type ApiResponse, createClient, createSession, createUser, expectApiError, loginAs } from '../_harness'

const GUARD = 'AUTH_PASSWORD_CHANGE_REQUIRED'
const DAY = 24 * 3_600_000
const notGuarded = (res: ApiResponse) => expect(res.body?.data?.code).not.toBe(GUARD)
const bodyFor = (method: string) => (method === 'GET' ? {} : { body: {} })

describe('forced password change guard', () => {
  it('blocks every other API route while mustChangePassword is set', async () => {
    const api = await loginAs(await createUser({ mustChangePassword: true }))
    for (const [method, path] of [
      ['GET', '/api/rooms'],
      ['POST', '/api/rooms'],
      ['PATCH', '/api/me'],
      ['GET', '/api/auth/sessions'],
      ['GET', '/api/recordings'],
      ['GET', '/api/admin/users'],
      ['POST', '/api/join/abc-defg-hjk/info'],
    ] as const) {
      expectApiError(await api.request(method, path, bodyFor(method)), 403, GUARD)
    }
  })

  it.each([
    ['GET', '/api/auth/me'],
    ['POST', '/api/auth/password'],
    ['POST', '/api/auth/logout'],
    ['GET', '/api/config'],
    ['GET', '/api/health'],
    ['GET', '/api/ready'],
  ])('lets %s %s through', async (method, path) => {
    const api = await loginAs(await createUser({ mustChangePassword: true }))
    notGuarded(await api.request(method, path, bodyFor(method)))
  })

  it('does not affect users without the flag or anonymous callers', async () => {
    notGuarded(await (await loginAs(await createUser())).get('/api/rooms'))
    notGuarded(await createClient().get('/api/rooms'))
  })

  it('checks CSRF before the guard', async () => {
    const api = await loginAs(await createUser({ mustChangePassword: true }))
    expectApiError(await api.post('/api/rooms', { origin: null }), 403, 'CSRF_REJECTED')
  })
})

describe('session resolution', () => {
  it('ignores sessions past the absolute or idle expiry and clears the cookie', async () => {
    const user = await createUser({ mustChangePassword: true })
    const expired = await createSession(user.id, { expiresAt: new Date(Date.now() - 1_000) })
    const idle = await createSession(user.id, { createdAt: new Date(Date.now() - 9 * DAY), lastSeenAt: new Date(Date.now() - 8 * DAY) })
    for (const session of [expired, idle]) {
      const api = createClient().setCookie(session.cookieName, session.token)
      const res = await api.get('/api/rooms')
      notGuarded(res)
      expect(res.setCookies.some((c) => c.startsWith(`${session.cookieName}=;`) && /Max-Age=0/i.test(c))).toBe(true)
      expect(api.cookie(session.cookieName)).toBeUndefined()
    }
  })

  it('ignores sessions of disabled users and malformed cookies', async () => {
    const disabled = await loginAs(await createUser({ mustChangePassword: true, disabled: true }))
    notGuarded(await disabled.get('/api/rooms'))
    const session = await createSession((await createUser({ mustChangePassword: true })).id)
    notGuarded(await createClient().setCookie(session.cookieName, 'not-a-token').get('/api/rooms'))
  })

  it('accepts a session close to, but inside, its limits', async () => {
    const user = await createUser({ mustChangePassword: true })
    const session = await createSession(user.id, {
      createdAt: new Date(Date.now() - 29 * DAY),
      lastSeenAt: new Date(Date.now() - 6 * DAY),
      expiresAt: new Date(Date.now() + DAY),
    })
    const res = await createClient().setCookie(session.cookieName, session.token).get('/api/rooms')
    expectApiError(res, 403, GUARD)
  })
})
