/**
 * POST /api/auth/register in the three registration modes, read live from the settings (no restart), the domain list,
 * domain mode's SMTP and verification requirements, and no enumeration in domain mode.
 */
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { authIdentities, users } from '../../../server/database/schema'
import {
  createClient,
  createUser,
  expectApiError,
  expectNoMessage,
  searchMessages,
  testDb,
  uniqueEmail,
  uniqueName,
  waitForMessage,
} from '../_harness'
import {
  auditRows,
  mailToken,
  resetRegistration,
  sessionCookie,
  setRegistration,
  signIn,
  sleep,
  startExtraServer,
  uniqueDomainEmail,
  WITHOUT_SMTP,
} from './support'

const PASSWORD = 'amber-falcon-ledger-73'
const DOMAIN = 'allowed.example.test'
const body = (email: string, password = PASSWORD) => ({ email, displayName: uniqueName('Reg'), password })

async function userByEmail(email: string) {
  const [row] = await testDb().select().from(users).where(eq(users.email, email))
  return row
}

afterAll(async () => {
  await resetRegistration()
})

describe('invite_only (default)', () => {
  beforeAll(async () => {
    await resetRegistration()
  })

  it('is closed: 403 REGISTRATION_CLOSED and nothing is created', async () => {
    const email = uniqueEmail()
    expectApiError(await createClient().post('/api/auth/register', { body: body(email) }), 403, 'REGISTRATION_CLOSED')
    expect(await userByEmail(email)).toBeUndefined()
  })
})

describe('open', () => {
  beforeAll(async () => {
    await setRegistration('open')
  })

  it('creates the account, signs it in and answers 201 { user }', async () => {
    const email = uniqueEmail()
    const api = createClient()
    const res = await api.post('/api/auth/register', { body: { ...body(email), email: email.toUpperCase() } })
    expect(res.status, res.text).toBe(201)
    expect(res.body.user).toMatchObject({ email, role: 'user', mustChangePassword: false, emailVerified: false })
    expect(sessionCookie(res)?.value).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect((await api.get('/api/auth/me')).body.user.email).toBe(email)
    const row = await userByEmail(email)
    expect(row?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/)
    const identities = await testDb()
      .select()
      .from(authIdentities)
      .where(and(eq(authIdentities.userId, row!.id), eq(authIdentities.provider, 'password')))
    expect(identities).toHaveLength(1)
    expect(await auditRows({ action: 'auth.registered', targetId: row!.id })).toHaveLength(1)
    // Open mode sends no mail.
    await expectNoMessage(email, 500)
  })

  it('rejects weak passwords', async () => {
    const weak = await createClient().post('/api/auth/register', { body: body(uniqueEmail(), 'password1234') })
    expectApiError(weak, 400, 'AUTH_PASSWORD_WEAK')
    expect(weak.body.data.details).toEqual({ reason: 'common' })
    expectApiError(
      await createClient().post('/api/auth/register', { body: body(uniqueEmail(), 'short') }),
      400,
      'VALIDATION_FAILED',
    )
  })

  it('answers 409 CONFLICT (email_taken) for an existing email: the documented open-mode limitation', async () => {
    const existing = await createUser()
    const res = await createClient().post('/api/auth/register', { body: body(existing.email) })
    expectApiError(res, 409, 'CONFLICT')
    expect(res.body.data.details).toEqual({ reason: 'email_taken' })
  })

  it('normalizes the display name', async () => {
    const email = uniqueEmail()
    const res = await createClient().post('/api/auth/register', {
      body: { email, password: PASSWORD, displayName: '  Ada\u200B \u202ELovelace\u202C  ' },
    })
    expect(res.body.user.displayName).toBe('Ada Lovelace')
  })
})

describe('domain', () => {
  beforeAll(async () => {
    await setRegistration('domain', [DOMAIN])
  })

  it('accepts only listed domains (exact match)', async () => {
    for (const email of [uniqueEmail(), uniqueDomainEmail(`sub.${DOMAIN}`), uniqueDomainEmail(`evil${DOMAIN}`)]) {
      expectApiError(
        await createClient().post('/api/auth/register', { body: body(email) }),
        403,
        'REGISTRATION_DOMAIN_NOT_ALLOWED',
      )
      expect(await userByEmail(email)).toBeUndefined()
    }
  })

  it('creates an unverified account, mails a verification link, answers 202; sign-in needs the verification', async () => {
    const email = uniqueDomainEmail(DOMAIN)
    const api = createClient()
    const res = await api.post('/api/auth/register', { body: body(email) })
    expect(res.status, res.text).toBe(202)
    expect(res.body).toEqual({ verificationRequired: true })
    expect(sessionCookie(res)).toBeUndefined()
    expect((await userByEmail(email))?.emailVerifiedAt).toBeNull()

    const token = await mailToken(email, '/verify-email', /Confirm your email/)
    expectApiError(await signIn(createClient(), email, PASSWORD), 403, 'AUTH_EMAIL_NOT_VERIFIED')
    expect((await createClient().post('/api/auth/verify-email', { body: { token } })).status).toBe(200)
    expect((await signIn(createClient(), email, PASSWORD)).status).toBe(200)
  })

  it('answers an existing email identically and mails "account exists" instead (no enumeration)', async () => {
    const existing = await createUser({ email: uniqueDomainEmail(DOMAIN) })
    const fresh = uniqueDomainEmail(DOMAIN)
    const known = await createClient().post('/api/auth/register', { body: body(existing.email) })
    const unknown = await createClient().post('/api/auth/register', { body: body(fresh) })
    expect(known.status).toBe(202)
    expect(known.text).toBe(unknown.text)
    for (const header of ['content-type', 'content-length', 'set-cookie']) {
      expect(known.headers.get(header), header).toBe(unknown.headers.get(header))
    }
    const exists = await waitForMessage(existing.email, { subject: /already have/ })
    expect(exists.Text).not.toMatch(/verify-email#|reset-password#|invite#/)
    await waitForMessage(fresh, { subject: /Confirm your email/ })
    await sleep(500)
    expect(await searchMessages(`to:"${existing.email}"`)).toHaveLength(1)
    // The existing account is untouched: its password still works.
    expect((await signIn(createClient(), existing.email, existing.password)).status).toBe(200)
  })

  it('needs SMTP: a server without SMTP answers 503 SERVICE_UNAVAILABLE', async () => {
    const server = await startExtraServer('no-smtp-register', WITHOUT_SMTP)
    try {
      const email = uniqueDomainEmail(DOMAIN)
      const api = createClient({ baseUrl: server.baseUrl })
      expectApiError(await api.post('/api/auth/register', { body: body(email) }), 503, 'SERVICE_UNAVAILABLE')
      expect(await userByEmail(email)).toBeUndefined()
      expect((await api.get('/api/config')).body.smtpEnabled).toBe(false)
    } finally {
      await server.stop()
    }
  })
})

describe('mode switch', () => {
  it('applies to the next request without a restart', async () => {
    await resetRegistration()
    const email = uniqueEmail()
    expectApiError(await createClient().post('/api/auth/register', { body: body(email) }), 403, 'REGISTRATION_CLOSED')
    await setRegistration('open')
    expect((await createClient().post('/api/auth/register', { body: body(email) })).status).toBe(201)
    await resetRegistration()
    expectApiError(
      await createClient().post('/api/auth/register', { body: body(uniqueEmail()) }),
      403,
      'REGISTRATION_CLOSED',
    )
  })
})
