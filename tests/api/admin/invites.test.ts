/**
 * /api/admin/invites through HTTP: the token is returned once (sha256 at rest, never listed), admin-role invites need
 * an email and 24 h, emailing needs SMTP, revocation is idempotent and makes the token unusable.
 */
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { userInvites } from '../../../server/database/schema'
import { hashToken } from '../../../server/utils/crypto'
import {
  createClient,
  createUser,
  expectApiError,
  extractFragmentToken,
  testDb,
  uniqueEmail,
  waitForMessage,
} from '../_harness'
import { ADMIN_INVITE_KEYS, auditRows, signedInAdmin, sortedKeys } from './_support'

const HOUR = 3_600_000

describe('POST /api/admin/invites', () => {
  it('returns the token once; only its sha256 is stored and the list never shows it', async () => {
    const { admin, api } = await signedInAdmin()
    const before = Date.now()
    const res = await api.post('/api/admin/invites', { body: { role: 'user', expiresIn: '7d' } })
    expect(res.status, res.text).toBe(201)
    expect(sortedKeys(res.body)).toEqual([...ADMIN_INVITE_KEYS, 'emailed', 'token'].sort())
    expect(res.body).toMatchObject({ email: null, role: 'user', revoked: false, usedAt: null, createdBy: admin.id, emailed: false })
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const ttl = Date.parse(res.body.expiresAt) - before
    expect(ttl).toBeGreaterThan(7 * 24 * HOUR - 60_000)
    expect(ttl).toBeLessThanOrEqual(7 * 24 * HOUR + 60_000)

    const [row] = await testDb().select().from(userInvites).where(eq(userInvites.id, res.body.id))
    expect(row!.tokenHash).toBe(hashToken(res.body.token))
    expect(JSON.stringify(row)).not.toContain(res.body.token)

    const list = await api.get('/api/admin/invites', { query: { pageSize: 100 } })
    expect(list.status, list.text).toBe(200)
    expect(list.text).not.toContain(res.body.token)
    const listed = list.body.items.find((item: { id: string }) => item.id === res.body.id)
    expect(sortedKeys(listed)).toEqual(ADMIN_INVITE_KEYS)

    // The token works on the public side.
    const preview = await createClient().post('/api/auth/invites/preview', { body: { token: res.body.token } })
    expect(preview.status, preview.text).toBe(200)
    expect(await auditRows({ action: 'admin.invite_created', targetId: res.body.id })).toHaveLength(1)
  })

  it('admin invites need an email and expire within 24 h', async () => {
    const { api } = await signedInAdmin()
    expectApiError(await api.post('/api/admin/invites', { body: { role: 'admin', expiresIn: '24h' } }), 400, 'VALIDATION_FAILED')
    expectApiError(
      await api.post('/api/admin/invites', { body: { role: 'admin', email: uniqueEmail(), expiresIn: '7d' } }),
      400,
      'VALIDATION_FAILED',
    )
    const email = uniqueEmail('admin-invite')
    const ok = await api.post('/api/admin/invites', { body: { role: 'admin', email, expiresIn: '24h' } })
    expect(ok.status, ok.text).toBe(201)
    expect(ok.body).toMatchObject({ role: 'admin', email })
    expect(Date.parse(ok.body.expiresAt) - Date.now()).toBeLessThanOrEqual(24 * HOUR)
  })

  it('emails the link when asked and refuses addresses that already have an account', async () => {
    const { api } = await signedInAdmin()
    const email = uniqueEmail('invited')
    const res = await api.post('/api/admin/invites', { body: { email, role: 'user', expiresIn: '24h', sendEmail: true } })
    expect(res.status, res.text).toBe(201)
    expect(res.body.emailed).toBe(true)
    const mail = await waitForMessage(email)
    expect(extractFragmentToken(mail.Text, '/invite')).toBe(res.body.token)

    expectApiError(await api.post('/api/admin/invites', { body: { sendEmail: true } }), 400, 'VALIDATION_FAILED')
    const taken = await api.post('/api/admin/invites', { body: { email: (await createUser()).email } })
    expectApiError(taken, 409, 'CONFLICT')
    expect(taken.body.data.details).toEqual({ reason: 'email_taken' })
  })
})

describe('GET /api/admin/invites', () => {
  it('lists newest first, filters by email and pages', async () => {
    const { api } = await signedInAdmin()
    const email = uniqueEmail('listed')
    const first = await api.post('/api/admin/invites', { body: { email } })
    const second = await api.post('/api/admin/invites', { body: { email, expiresIn: '30d' } })
    const res = await api.get('/api/admin/invites', { query: { q: email } })
    expect(res.status, res.text).toBe(200)
    expect(res.body).toMatchObject({ page: 1, pageSize: 25, total: 2 })
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([second.body.id, first.body.id])
    expectApiError(await api.get('/api/admin/invites', { query: { page: 0 } }), 400, 'VALIDATION_FAILED')
  })
})

describe('DELETE /api/admin/invites/:id', () => {
  it('revokes (idempotently) and the token stops working', async () => {
    const { api } = await signedInAdmin()
    const created = await api.post('/api/admin/invites', { body: {} })
    const res = await api.delete(`/api/admin/invites/${created.body.id}`)
    expect(res.status, res.text).toBe(204)
    expect((await api.delete(`/api/admin/invites/${created.body.id}`)).status).toBe(204)
    expect(await auditRows({ action: 'admin.invite_revoked', targetId: created.body.id })).toHaveLength(1)
    const listed = await api.get('/api/admin/invites', { query: { pageSize: 100 } })
    expect(listed.body.items.find((item: { id: string }) => item.id === created.body.id).revoked).toBe(true)
    expectApiError(
      await createClient().post('/api/auth/invites/preview', { body: { token: created.body.token } }),
      400,
      'INVITE_INVALID',
    )
    expectApiError(await api.delete('/api/admin/invites/01890000-0000-7000-8000-000000000000'), 404, 'NOT_FOUND')
    expectApiError(await api.delete('/api/admin/invites/not-an-id'), 404, 'NOT_FOUND')
  })
})
