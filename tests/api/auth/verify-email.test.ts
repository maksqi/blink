/**
 * POST /api/auth/verify-email: single use, 24 h expiry, purpose-bound, no sign-in, auth-ip limiter.
 */
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { users } from '../../../server/database/schema'
import { createClient, createUser, expectApiError, testDb } from '../_harness'
import { auditRows, createEmailToken, sessionCookie } from './support'

const verify = (token: string, client = createClient()) => client.post('/api/auth/verify-email', { body: { token } })

async function verifiedAt(userId: string) {
  const [row] = await testDb().select({ at: users.emailVerifiedAt }).from(users).where(eq(users.id, userId))
  return row?.at ?? null
}

describe('POST /api/auth/verify-email', () => {
  it('verifies the address once and does not sign in', async () => {
    const user = await createUser({ emailVerified: false })
    const token = await createEmailToken(user.id, 'verify_email', { expiresAt: new Date(Date.now() + 24 * 3_600_000) })
    const res = await verify(token)
    expect(res.status, res.text).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(sessionCookie(res)).toBeUndefined()
    expect(await verifiedAt(user.id)).not.toBeNull()
    expect(await auditRows({ action: 'auth.email_verified', targetId: user.id })).toHaveLength(1)
    expectApiError(await verify(token), 400, 'AUTH_TOKEN_INVALID')
  })

  it('shows the new state to signed-in sessions at once', async () => {
    const user = await createUser({ emailVerified: false })
    const api = createClient()
    await api.post('/api/auth/login', { body: { email: user.email, password: user.password } })
    expect((await api.get('/api/auth/me')).body.user.emailVerified).toBe(false)
    await verify(await createEmailToken(user.id, 'verify_email'))
    expect((await api.get('/api/auth/me')).body.user.emailVerified).toBe(true)
  })

  it('rejects expired tokens with AUTH_TOKEN_EXPIRED', async () => {
    const user = await createUser({ emailVerified: false })
    const token = await createEmailToken(user.id, 'verify_email', { expiresAt: new Date(Date.now() - 1_000) })
    expectApiError(await verify(token), 400, 'AUTH_TOKEN_EXPIRED')
    expect(await verifiedAt(user.id)).toBeNull()
  })

  it('rejects unknown, used and reset tokens with AUTH_TOKEN_INVALID, malformed ones with VALIDATION_FAILED', async () => {
    const user = await createUser({ emailVerified: false })
    expectApiError(await verify('V'.repeat(43)), 400, 'AUTH_TOKEN_INVALID')
    expectApiError(
      await verify(await createEmailToken(user.id, 'verify_email', { usedAt: new Date() })),
      400,
      'AUTH_TOKEN_INVALID',
    )
    expectApiError(await verify(await createEmailToken(user.id, 'reset_password')), 400, 'AUTH_TOKEN_INVALID')
    expectApiError(await verify('short'), 400, 'VALIDATION_FAILED')
    expectApiError(await createClient().post('/api/auth/verify-email', { body: {} }), 400, 'VALIDATION_FAILED')
    expect(await verifiedAt(user.id)).toBeNull()
  })

  it('is limited to 10 requests per minute per IP (auth-ip), with Retry-After', async () => {
    const api = createClient()
    for (let i = 0; i < 10; i++) expectApiError(await verify('W'.repeat(43), api), 400, 'AUTH_TOKEN_INVALID')
    const limited = await verify('W'.repeat(43), api)
    expectApiError(limited, 429, 'RATE_LIMITED')
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
    // Another IP is not affected.
    expectApiError(await verify('W'.repeat(43)), 400, 'AUTH_TOKEN_INVALID')
  })
})
