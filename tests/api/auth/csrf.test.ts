/**
 * CSRF on the auth endpoints: a cross-origin login never reaches the login logic (no cookie, no backoff row, no
 * audit entry), and every auth mutation needs the public origin.
 */
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { loginThrottle } from '../../../server/database/schema'
import { createClient, createUser, expectApiError, loginAs, testDb, uniqueEmail } from '../_harness'
import { sessionCookie, signIn } from './support'

describe('CSRF on /api/auth', () => {
  it('rejects a cross-origin login before it is attempted', async () => {
    const user = await createUser()
    for (const origin of ['https://evil.test', 'null']) {
      const res = await signIn(createClient(), user.email, 'wrong-password-xx', { origin })
      expectApiError(res, 403, 'CSRF_REJECTED')
      expect(sessionCookie(res)).toBeUndefined()
    }
    const res = await createClient().post('/api/auth/login', {
      body: { email: user.email, password: user.password },
      headers: { 'sec-fetch-site': 'cross-site' },
    })
    expectApiError(res, 403, 'CSRF_REJECTED')
    expect(sessionCookie(res)).toBeUndefined()
    expectApiError(
      await createClient().post('/api/auth/login', {
        origin: null,
        body: { email: user.email, password: user.password },
      }),
      403,
      'CSRF_REJECTED',
    )
    // Nothing was counted as a failed attempt.
    expect(
      await testDb()
        .select()
        .from(loginThrottle)
        .where(eq(loginThrottle.key, `email:${user.email}`)),
    ).toEqual([])
    // The same request from the public origin works.
    expect((await signIn(createClient(), user.email, user.password)).status).toBe(200)
  })

  it.each([
    ['POST', '/api/auth/register', { email: uniqueEmail(), displayName: 'X', password: 'amber-falcon-ledger-73' }],
    ['POST', '/api/auth/password-reset/request', { email: uniqueEmail() }],
    ['POST', '/api/auth/password-reset/confirm', { token: 'A'.repeat(43), newPassword: 'amber-falcon-ledger-73' }],
    [
      'POST',
      '/api/auth/invites/accept',
      { token: 'A'.repeat(43), displayName: 'X', password: 'amber-falcon-ledger-73' },
    ],
    ['POST', '/api/auth/verify-email', { token: 'A'.repeat(43) }],
    ['POST', '/api/auth/password', { currentPassword: 'x', newPassword: 'amber-falcon-ledger-73' }],
    ['POST', '/api/auth/logout', undefined],
    ['PATCH', '/api/me', { displayName: 'Mallory' }],
  ] as const)('rejects a cross-origin %s %s', async (method, path, body) => {
    const api = await loginAs(await createUser())
    const res = await api.request(method, path, { origin: 'https://evil.test', ...(body ? { body } : {}) })
    expectApiError(res, 403, 'CSRF_REJECTED')
    expect((await api.get('/api/auth/me')).body.user).not.toBeNull() // e.g. the logout did not happen
  })

  it('rejects a cross-origin session revocation', async () => {
    const api = await loginAs(await createUser())
    const res = await api.delete(`/api/auth/sessions/${api.session!.id}`, { origin: 'https://evil.test' })
    expectApiError(res, 403, 'CSRF_REJECTED')
    expect((await api.get('/api/auth/me')).body.user).not.toBeNull()
  })
})
