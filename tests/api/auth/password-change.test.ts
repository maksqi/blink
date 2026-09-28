/**
 * POST /api/auth/password: verifies the current password, applies the policy, clears must_change_password, revokes
 * every other session, rotates the current one and publishes user.revoked.
 */
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { sessions, users } from '../../../server/database/schema'
import { changePassword } from '../../../server/services/auth/password-change'
import { createSession as createServiceSession } from '../../../server/services/session/sessions'
import { subscribeTo } from '../../../server/utils/event-bus'
import {
  createClient,
  createUser,
  expectApiError,
  fakeEvent,
  loginAs,
  testDb,
  useServerEnvInProcess,
} from '../_harness'
import { auditRows, sessionCookie, sessionIds, signIn } from './support'

useServerEnvInProcess()

const NEW_PASSWORD = 'indigo-harvest-lamp-27'
const change = (client: ReturnType<typeof createClient>, currentPassword: string, newPassword = NEW_PASSWORD) =>
  client.post('/api/auth/password', { body: { currentPassword, newPassword } })

describe('POST /api/auth/password', () => {
  it('changes the password, revokes every other session and rotates this one', async () => {
    const user = await createUser({ mustChangePassword: true })
    const api = createClient()
    await signIn(api, user.email, user.password)
    const [laptop, phone] = [await loginAs(user), await loginAs(user)]
    const before = api.cookie('blinq_session')!

    const res = await change(api, user.password)
    expect(res.status, res.text).toBe(200)
    expect(res.body.user).toMatchObject({ id: user.id, mustChangePassword: false })
    const rotated = sessionCookie(res)!.value
    expect(rotated).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(rotated).not.toBe(before)

    expect((await api.get('/api/auth/me')).body.user.mustChangePassword).toBe(false)
    for (const other of [laptop, phone]) expect((await other.get('/api/auth/me')).body.user).toBeNull()
    expect((await createClient().setCookie('blinq_session', before).get('/api/auth/me')).body.user).toBeNull()
    expect(await sessionIds(user.id)).toHaveLength(1)
    expect(await auditRows({ action: 'auth.password_changed', targetId: user.id })).toHaveLength(1)

    expectApiError(await signIn(createClient(), user.email, user.password), 401, 'AUTH_INVALID_CREDENTIALS')
    expect((await signIn(createClient(), user.email, NEW_PASSWORD)).status).toBe(200)
  })

  it('refuses a wrong current password without changing anything', async () => {
    const user = await createUser()
    const api = await loginAs(user)
    const other = await loginAs(user)
    expectApiError(await change(api, 'not-my-password-00'), 401, 'AUTH_INVALID_CREDENTIALS')
    expect((await other.get('/api/auth/me')).body.user).not.toBeNull()
    expect((await signIn(createClient(), user.email, user.password)).status).toBe(200)
  })

  it('backs off repeated wrong current passwords (429 with Retry-After)', async () => {
    const user = await createUser()
    const api = await loginAs(user)
    for (let i = 0; i < 6; i++)
      expectApiError(await change(api, `wrong-password-${i}0000`), 401, 'AUTH_INVALID_CREDENTIALS')
    const limited = await change(api, user.password)
    expectApiError(limited, 429, 'RATE_LIMITED')
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
  })

  it('applies the policy and refuses the current password as the new one', async () => {
    const user = await createUser()
    const api = await loginAs(user)
    const weak = await change(api, user.password, 'qwerty123456')
    expectApiError(weak, 400, 'AUTH_PASSWORD_WEAK')
    expect(weak.body.data.details).toEqual({ reason: 'common' })
    const reused = await change(api, user.password, user.password)
    expectApiError(reused, 400, 'AUTH_PASSWORD_WEAK')
    expect(reused.body.data.details).toEqual({ reason: 'same_as_current' })
    // Nothing changed.
    expect((await signIn(createClient(), user.email, user.password)).status).toBe(200)
  })

  it('needs a session and a valid body', async () => {
    expectApiError(await change(createClient(), 'x', NEW_PASSWORD), 401, 'UNAUTHENTICATED')
    const api = await loginAs(await createUser())
    expectApiError(await api.post('/api/auth/password', { body: { currentPassword: 'x' } }), 400, 'VALIDATION_FAILED')
    expectApiError(await change(api, 'x', 'short'), 400, 'VALIDATION_FAILED')
  })

  it('publishes user.revoked so live call identities of the user are removed', async () => {
    const user = await createUser()
    const token = await createServiceSession(user.id)
    const event = fakeEvent({
      cookie: `blinq_session=${token}`,
      ip: '198.51.100.44',
      method: 'POST',
      path: '/api/auth/password',
    })
    const revoked: string[] = []
    const off = subscribeTo('user.revoked', (e) => revoked.push(e.userId))
    try {
      const updated = await changePassword(event, { currentPassword: user.password, newPassword: NEW_PASSWORD })
      expect(updated.id).toBe(user.id)
    } finally {
      off()
    }
    expect(revoked).toEqual([user.id])
    expect(String(event.node.res.getHeader('set-cookie'))).toMatch(/^blinq_session=[A-Za-z0-9_-]{43};/)
    const [row] = await testDb().select().from(users).where(eq(users.id, user.id))
    expect(row!.mustChangePassword).toBe(false)
    const rows = await testDb().select().from(sessions).where(eq(sessions.userId, user.id))
    expect(rows).toHaveLength(1)
  })
})
