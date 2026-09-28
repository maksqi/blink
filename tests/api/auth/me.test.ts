/**
 * GET /api/auth/me and PATCH /api/me.
 */
import { describe, expect, it } from 'vitest'
import { createClient, createUser, expectApiError, loginAs } from '../_harness'
import { auditRows } from './support'

describe('GET /api/auth/me', () => {
  it('answers { user: null } with 200 for anonymous callers and ignores malformed cookies', async () => {
    const anonymous = await createClient().get('/api/auth/me')
    expect(anonymous.status).toBe(200)
    expect(anonymous.body).toEqual({ user: null })
    expect(anonymous.headers.get('cache-control')).toBe('no-store')
    const junk = await createClient().setCookie('blinq_session', 'junk').get('/api/auth/me')
    expect(junk.body).toEqual({ user: null })
  })

  it('returns exactly the AuthUser fields', async () => {
    const user = await createUser({ mustChangePassword: true })
    const res = await (await loginAs(user)).get('/api/auth/me')
    expect(res.body).toEqual({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: 'user',
        mustChangePassword: true,
        emailVerified: true,
      },
    })
  })
})

describe('PATCH /api/me', () => {
  it('renames the user, normalized, visible to the next request, audited', async () => {
    const user = await createUser()
    const api = await loginAs(user)
    await api.get('/api/auth/me') // cached by the server now
    const res = await api.patch('/api/me', { body: { displayName: '  Grace \u200BHopper\u202E  ' } })
    expect(res.status, res.text).toBe(200)
    expect(res.body.user).toMatchObject({ id: user.id, displayName: 'Grace Hopper' })
    expect((await api.get('/api/auth/me')).body.user.displayName).toBe('Grace Hopper')
    expect(await auditRows({ action: 'user.profile_updated', targetId: user.id })).toHaveLength(1)
  })

  it('validates the name and needs a session', async () => {
    const api = await loginAs(await createUser())
    expectApiError(await api.patch('/api/me', { body: { displayName: '   ' } }), 400, 'VALIDATION_FAILED')
    expectApiError(await api.patch('/api/me', { body: {} }), 400, 'VALIDATION_FAILED')
    expectApiError(await createClient().patch('/api/me', { body: { displayName: 'Nobody' } }), 401, 'UNAUTHENTICATED')
  })
})
