/**
 * Account invites: preview, accept (bound and unbound), single use under concurrency, expiry, revocation, admin
 * invites bound to an email within 24 h, every registration mode.
 */
import { eq, inArray } from 'drizzle-orm'
import { H3Error } from 'h3'
import { describe, expect, it } from 'vitest'
import { userInvites, users } from '../../../server/database/schema'
import { createAccountInvite, revokeAccountInvite } from '../../../server/services/users/invites'
import {
  createAdmin,
  createClient,
  createInvite,
  createUser,
  expectApiError,
  testDb,
  uniqueEmail,
  uniqueName,
  useServerEnvInProcess,
} from '../_harness'
import { auditRows, resetRegistration, sessionCookie, setRegistration, signIn } from './support'

useServerEnvInProcess()

const PASSWORD = 'copper-meadow-violin-58'
const accept = (token: string, extra: Record<string, unknown> = {}) =>
  createClient().post('/api/auth/invites/accept', {
    body: { token, displayName: uniqueName('Invited'), password: PASSWORD, ...extra },
  })

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
  } catch (error) {
    if (error instanceof H3Error) return (error.data as { code?: string }).code
    throw error
  }
  return undefined
}

describe('POST /api/auth/invites/preview', () => {
  it('describes a valid invite', async () => {
    const bound = await createInvite({ email: uniqueEmail(), role: 'admin' })
    const res = await createClient().post('/api/auth/invites/preview', { body: { token: bound.token } })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ email: bound.row.email, role: 'admin', expiresAt: bound.row.expiresAt.toISOString() })
    const open = await createInvite()
    expect(
      (await createClient().post('/api/auth/invites/preview', { body: { token: open.token } })).body.email,
    ).toBeNull()
  })

  it('answers unknown and revoked with INVITE_INVALID, used and expired with 410', async () => {
    const preview = (token: string) => createClient().post('/api/auth/invites/preview', { body: { token } })
    expectApiError(await preview('A'.repeat(43)), 400, 'INVITE_INVALID')
    expectApiError(await preview((await createInvite({ revoked: true })).token), 400, 'INVITE_INVALID')
    expectApiError(await preview((await createInvite({ used: true })).token), 410, 'INVITE_USED')
    expectApiError(
      await preview((await createInvite({ expiresAt: new Date(Date.now() - 1_000) })).token),
      410,
      'INVITE_EXPIRED',
    )
    expectApiError(await preview('too-short'), 400, 'VALIDATION_FAILED')
  })
})

describe('POST /api/auth/invites/accept', () => {
  it('creates the account from an unbound invite, signs it in and answers 201', async () => {
    const invite = await createInvite()
    const email = uniqueEmail()
    const api = createClient()
    const res = await api.post('/api/auth/invites/accept', {
      body: { token: invite.token, email: email.toUpperCase(), displayName: 'New Person', password: PASSWORD },
    })
    expect(res.status, res.text).toBe(201)
    expect(res.body.user).toMatchObject({
      email,
      displayName: 'New Person',
      role: 'user',
      emailVerified: false,
      mustChangePassword: false,
    })
    expect(sessionCookie(res)?.value).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect((await api.get('/api/auth/me')).body.user.email).toBe(email)
    const [row] = await testDb().select().from(userInvites).where(eq(userInvites.id, invite.id))
    expect(row!.usedAt).not.toBeNull()
    expect(row!.usedBy).toBe(res.body.user.id)
    expect(await auditRows({ action: 'auth.invite_accepted', targetId: invite.id })).toHaveLength(1)
    expect((await signIn(createClient(), email, PASSWORD)).status).toBe(200)
  })

  it('binds an invite to its email: takes it, refuses another one, counts it as verified', async () => {
    const email = uniqueEmail()
    const invite = await createInvite({ email })
    expectApiError(await accept(invite.token, { email: uniqueEmail() }), 400, 'INVITE_INVALID')
    const res = await accept(invite.token)
    expect(res.status, res.text).toBe(201)
    expect(res.body.user).toMatchObject({ email, emailVerified: true })
  })

  it('needs an email for unbound invites and a strong password, without using the invite up', async () => {
    const invite = await createInvite()
    expectApiError(await accept(invite.token), 400, 'VALIDATION_FAILED')
    const weak = await accept(invite.token, { email: uniqueEmail(), password: 'password1234' })
    expectApiError(weak, 400, 'AUTH_PASSWORD_WEAK')
    expect((await accept(invite.token, { email: uniqueEmail() })).status).toBe(201)
  })

  it('answers 409 CONFLICT for an email that already has an account', async () => {
    const existing = await createUser()
    const invite = await createInvite({ email: existing.email })
    const res = await accept(invite.token)
    expectApiError(res, 409, 'CONFLICT')
    expect(res.body.data.details).toEqual({ reason: 'email_taken' })
    const [row] = await testDb().select().from(userInvites).where(eq(userInvites.id, invite.id))
    expect(row!.usedAt).toBeNull()
  })

  it('refuses revoked, used and expired invites', async () => {
    expectApiError(
      await accept((await createInvite({ revoked: true })).token, { email: uniqueEmail() }),
      400,
      'INVITE_INVALID',
    )
    expectApiError(
      await accept((await createInvite({ used: true })).token, { email: uniqueEmail() }),
      410,
      'INVITE_USED',
    )
    const expired = await createInvite({ expiresAt: new Date(Date.now() - 1_000) })
    expectApiError(await accept(expired.token, { email: uniqueEmail() }), 410, 'INVITE_EXPIRED')
  })

  it('is single use, also under concurrent accepts', async () => {
    const invite = await createInvite()
    const emails = Array.from({ length: 5 }, () => uniqueEmail('race'))
    const results = await Promise.all(emails.map((email) => accept(invite.token, { email })))
    const statuses = results.map((res) => res.status).sort()
    expect(statuses, results.map((r) => r.text).join('\n')).toEqual([201, 410, 410, 410, 410])
    for (const res of results.filter((r) => r.status === 410)) expectApiError(res, 410, 'INVITE_USED')
    const created = await testDb().select({ email: users.email }).from(users).where(inArray(users.email, emails))
    expect(created).toHaveLength(1)
    // Once used, it stays used.
    expectApiError(await accept(invite.token, { email: uniqueEmail() }), 410, 'INVITE_USED')
  })

  it('works in every registration mode and bypasses the domain list', async () => {
    await setRegistration('domain', ['allowed.example.test'])
    try {
      const invite = await createInvite()
      const res = await accept(invite.token, { email: uniqueEmail() })
      expect(res.status, res.text).toBe(201)
    } finally {
      await resetRegistration()
    }
  })
})

describe('admin invites (users service)', () => {
  it('must be bound to an email and expire within 24 hours', async () => {
    const admin = await createAdmin()
    const actor = { user: { id: admin.id, role: 'admin' as const }, event: null }
    expect(await codeOf(createAccountInvite({ role: 'admin', expiresIn: '24h' }, actor))).toBe('VALIDATION_FAILED')
    expect(await codeOf(createAccountInvite({ role: 'admin', email: uniqueEmail(), expiresIn: '7d' }, actor))).toBe(
      'VALIDATION_FAILED',
    )

    const email = uniqueEmail('new-admin')
    const created = await createAccountInvite({ role: 'admin', email, expiresIn: '24h' }, actor)
    expect(created).toMatchObject({
      email,
      role: 'admin',
      revoked: false,
      usedAt: null,
      emailed: false,
      createdBy: admin.id,
    })
    expect(new Date(created.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(24 * 3_600_000)
    const [row] = await testDb().select().from(userInvites).where(eq(userInvites.id, created.id))
    expect(row!.tokenHash).not.toBe(created.token) // only the hash is stored

    expectApiError(await accept(created.token, { email: uniqueEmail() }), 400, 'INVITE_INVALID')
    const res = await accept(created.token)
    expect(res.status).toBe(201)
    expect(res.body.user).toMatchObject({ email, role: 'admin', emailVerified: true })
  })

  it('can be revoked; a revoked invite is invalid', async () => {
    const admin = await createAdmin()
    const actor = { user: { id: admin.id, role: 'admin' as const }, event: null }
    const created = await createAccountInvite({ role: 'user', expiresIn: '7d' }, actor)
    const revoked = await revokeAccountInvite(created.id, actor)
    expect(revoked.revoked).toBe(true)
    expect((await revokeAccountInvite(created.id, actor)).revoked).toBe(true) // idempotent
    expectApiError(await accept(created.token, { email: uniqueEmail() }), 400, 'INVITE_INVALID')
    expect(await auditRows({ action: 'admin.invite_revoked', targetId: created.id })).toHaveLength(1)
  })
})
