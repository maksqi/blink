/**
 * POST /api/admin/settings/test-email: Mailpit receives the message (default recipient: the admin); without SMTP or
 * when the SMTP server fails, 503 SERVICE_UNAVAILABLE with a short `details.smtpError` and never the credentials.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createClient,
  expectApiError,
  expectNoMessage,
  loginAs,
  type TestServer,
  uniqueEmail,
  waitForMessage,
} from '../_harness'
import { auditRows, signedInAdmin, startAdminServer, WITHOUT_SMTP } from './_support'

const SMTP_PASSWORD = 'change-me-smtp-password-for-tests'

describe('with SMTP (Mailpit)', () => {
  it('sends to the calling admin by default and audits it', async () => {
    const { admin, api } = await signedInAdmin()
    const res = await api.post('/api/admin/settings/test-email')
    expect(res.status, res.text).toBe(200)
    expect(res.body).toEqual({ ok: true })
    const mail = await waitForMessage(admin.email)
    expect(mail.Subject).toMatch(/test/i)
    const [entry] = await auditRows({ action: 'admin.test_email_sent', actorUserId: admin.id })
    expect(entry).toMatchObject({ targetType: 'email', details: { to: admin.email } })
  })

  it('sends to another address when given', async () => {
    const { api } = await signedInAdmin()
    const to = uniqueEmail('smtp-check')
    const res = await api.post('/api/admin/settings/test-email', { body: { to: to.toUpperCase() } })
    expect(res.status, res.text).toBe(200)
    await waitForMessage(to)
    expectApiError(await api.post('/api/admin/settings/test-email', { body: { to: 'nope' } }), 400, 'VALIDATION_FAILED')
  })
})

describe('without SMTP', () => {
  let server: TestServer

  beforeAll(async () => {
    server = await startAdminServer('test-email-no-smtp', WITHOUT_SMTP)
  })

  afterAll(async () => {
    await server?.stop()
  })

  it('answers 503 SERVICE_UNAVAILABLE and sends nothing', async () => {
    const { admin } = await signedInAdmin()
    const api = await loginAs(admin, createClient({ baseUrl: server.baseUrl }))
    const res = await api.post('/api/admin/settings/test-email')
    expectApiError(res, 503, 'SERVICE_UNAVAILABLE')
    expect(res.body.data.details).toEqual({ smtpError: 'SMTP is not configured' })
    await expectNoMessage(admin.email)
    expect(await auditRows({ action: 'admin.test_email_sent', actorUserId: admin.id })).toEqual([])
  })
})

describe('when the SMTP server cannot be reached', () => {
  let server: TestServer

  beforeAll(async () => {
    // Nothing listens on port 9 (discard) on loopback: the connection is refused at once.
    server = await startAdminServer('test-email-broken-smtp', {
      SMTP_PORT: '9',
      SMTP_USER: 'smtp-user',
      SMTP_PASSWORD,
    })
  })

  afterAll(async () => {
    await server?.stop()
  })

  it('answers 503 with the SMTP error message only, never the credentials', async () => {
    const { admin } = await signedInAdmin()
    const api = await loginAs(admin, createClient({ baseUrl: server.baseUrl }))
    const res = await api.post('/api/admin/settings/test-email')
    expectApiError(res, 503, 'SERVICE_UNAVAILABLE')
    expect(typeof res.body.data.details.smtpError).toBe('string')
    expect(res.body.data.details.smtpError.length).toBeGreaterThan(0)
    expect(res.text).not.toContain(SMTP_PASSWORD)
    expect(res.text).not.toContain('smtp-user')
  })
})
