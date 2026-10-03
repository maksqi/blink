/**
 * Admin settings apply to the very next request, without a restart: registration mode, guest access. Also the GET
 * shape (settings plus SMTP status), strict partial updates, the merged-result rules and the audit entry.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SETTINGS_DEFAULTS } from '#shared/schemas/settings'
import {
  type ApiClient,
  createClient,
  createRoom,
  createUser,
  expectApiError,
  loginAs,
  serverEnv,
  type TestServer,
  uniqueEmail,
  uniqueName,
} from '../_harness'
import { joinGuest } from '../rooms/_support'
import { auditRows, putSettings, restoreSettings, signedInAdmin, startAdminServer, WITHOUT_SMTP } from './_support'

let api: ApiClient
let adminId: string

beforeAll(async () => {
  const signedIn = await signedInAdmin()
  api = signedIn.api
  adminId = signedIn.admin.id
})

afterEach(async () => {
  await restoreSettings(api)
})

describe('GET /api/admin/settings', () => {
  it('returns every setting and the SMTP status without credentials', async () => {
    const res = await api.get('/api/admin/settings')
    expect(res.status, res.text).toBe(200)
    expect(Object.keys(res.body).sort()).toEqual(['settings', 'smtp'])
    expect(res.body.settings).toEqual(SETTINGS_DEFAULTS)
    expect(res.body.smtp).toEqual({ configured: true, host: serverEnv().SMTP_HOST, from: serverEnv().SMTP_FROM })
    expect(res.text).not.toMatch(/system\.|password/i)
  })
})

describe('PUT /api/admin/settings', () => {
  it('opens registration for the very next request', async () => {
    const email = uniqueEmail('open')
    const register = () =>
      createClient().post('/api/auth/register', {
        body: { email, displayName: uniqueName('Open'), password: 'meadow-copper-lantern-63' },
      })
    expectApiError(await register(), 403, 'REGISTRATION_CLOSED')
    const res = await putSettings(api, { 'registration.mode': 'open' })
    expect(res.status, res.text).toBe(200)
    expect(res.body.settings['registration.mode']).toBe('open')
    const registered = await register()
    expect(registered.status, registered.text).toBe(201)
  })

  it('turns guest access off for the very next join and back on', async () => {
    const room = await createRoom(await createUser(), { waitingRoom: false })
    expect((await putSettings(api, { 'guests.allowed': false })).status).toBe(200)
    expectApiError((await joinGuest(room)).res, 403, 'ROOM_GUESTS_NOT_ALLOWED')
    expect((await putSettings(api, { 'guests.allowed': true })).status).toBe(200)
    const allowed = (await joinGuest(room)).res
    expect(allowed.body?.data?.code).not.toBe('ROOM_GUESTS_NOT_ALLOWED')
    expect([200, 202]).toContain(allowed.status)
  })

  it('changes only the keys that were sent and audits old and new values', async () => {
    const res = await putSettings(api, { 'limits.maxRoomsPerUser': 7, 'media.maxScreenShareFps': 30 })
    expect(res.status, res.text).toBe(200)
    expect(res.body.settings).toEqual({
      ...SETTINGS_DEFAULTS,
      'limits.maxRoomsPerUser': 7,
      'media.maxScreenShareFps': 30,
    })
    const second = await putSettings(api, { 'recording.enabled': false })
    expect(second.body.settings['limits.maxRoomsPerUser']).toBe(7)
    expect((await api.get('/api/admin/settings')).body.settings['recording.enabled']).toBe(false)
    expect((await createClient().get('/api/config')).body.recording.enabled).toBe(false)

    const entries = (await auditRows({ action: 'admin.settings_updated', actorUserId: adminId })).slice(-2)
    expect(entries[0]!.details).toEqual({
      fields: ['media.maxScreenShareFps', 'limits.maxRoomsPerUser'],
      old: { 'media.maxScreenShareFps': 15, 'limits.maxRoomsPerUser': 50 },
      new: { 'media.maxScreenShareFps': 30, 'limits.maxRoomsPerUser': 7 },
    })
    expect(entries[1]!.details).toEqual({
      fields: ['recording.enabled'],
      old: { 'recording.enabled': true },
      new: { 'recording.enabled': false },
    })
  })

  it('rejects unknown, internal and invalid keys with VALIDATION_FAILED', async () => {
    for (const patch of [
      { nope: true },
      { 'system.bootstrapDone': false },
      { 'limits.maxParticipantsPerRoom': 26 },
      { 'media.maxScreenShareFps': 20 },
      { 'registration.allowedDomains': ['not a domain'] },
    ]) {
      const res = await putSettings(api, patch)
      expectApiError(res, 400, 'VALIDATION_FAILED')
      expect(res.body.data.details.issues.length).toBeGreaterThan(0)
    }
    expect((await api.get('/api/admin/settings')).body.settings).toEqual(SETTINGS_DEFAULTS)
  })

  it('domain registration needs at least one domain (details.field)', async () => {
    const res = await putSettings(api, { 'registration.mode': 'domain' })
    expectApiError(res, 400, 'VALIDATION_FAILED')
    expect(res.body.data.details.field).toBe('registration.allowedDomains')
    const ok = await putSettings(api, { 'registration.mode': 'domain', 'registration.allowedDomains': ['Example.COM'] })
    expect(ok.status, ok.text).toBe(200)
    expect(ok.body.settings['registration.allowedDomains']).toEqual(['example.com'])
  })
})

describe('without SMTP', () => {
  let server: TestServer
  let noSmtp: ApiClient

  beforeAll(async () => {
    server = await startAdminServer('settings-no-smtp', WITHOUT_SMTP)
    const { admin } = await signedInAdmin()
    noSmtp = await loginAs(admin, createClient({ baseUrl: server.baseUrl }))
  })

  afterAll(async () => {
    await server?.stop()
  })

  it('reports SMTP as not configured and refuses domain registration (details.field)', async () => {
    const settings = await noSmtp.get('/api/admin/settings')
    expect(settings.body.smtp).toEqual({ configured: false, host: null, from: null })
    const res = await putSettings(noSmtp, { 'registration.mode': 'domain', 'registration.allowedDomains': ['example.com'] })
    expectApiError(res, 400, 'VALIDATION_FAILED')
    expect(res.body.data.details.field).toBe('registration.mode')
  })
})
