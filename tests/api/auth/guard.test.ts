/**
 * The bootstrap admin (created by the real `cli bootstrap` on its own database) must change the password first:
 * until then every API except the allowlist answers 403 AUTH_PASSWORD_CHANGE_REQUIRED.
 */
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type ApiResponse,
  createClient,
  createScratchDatabase,
  expectApiError,
  REPO_ROOT,
  runCli,
  serverEnv,
  startTestServer,
  type TestServer,
  uniqueEmail,
} from '../_harness'

const GUARD = 'AUTH_PASSWORD_CHANGE_REQUIRED'
const ADMIN_PASSWORD = 'violet-harbor-lantern-42'
const NEW_PASSWORD = 'mauve-kettle-orbit-81-quartz'

let scratch: Awaited<ReturnType<typeof createScratchDatabase>>
let server: TestServer
const adminEmail = uniqueEmail('bootstrap')

beforeAll(async () => {
  scratch = await createScratchDatabase('guard')
  const env = { ...serverEnv(), DATABASE_URL: scratch.url }
  const migrated = await runCli(['migrate'], env)
  expect(migrated.code, migrated.stderr).toBe(0)
  const booted = await runCli(['bootstrap'], { ...env, ADMIN_EMAIL: adminEmail, ADMIN_PASSWORD })
  expect(booted.code, booted.stderr).toBe(0)
  server = await startTestServer(env, { logFile: join(REPO_ROOT, 'test-results', 'api-auth-guard.log') })
})

afterAll(async () => {
  await server?.stop()
  await scratch?.drop()
})

const guarded = (res: ApiResponse) => expectApiError(res, 403, GUARD)
const notGuarded = (res: ApiResponse) => expect(res.body?.data?.code, `${res.status} ${res.text}`).not.toBe(GUARD)

describe('bootstrap admin', () => {
  it('is forced through a password change before anything else works', async () => {
    const api = createClient({ baseUrl: server.baseUrl })
    const login = await api.post('/api/auth/login', { body: { email: adminEmail, password: ADMIN_PASSWORD } })
    expect(login.status, login.text).toBe(200)
    expect(login.body.user).toMatchObject({
      email: adminEmail,
      role: 'admin',
      mustChangePassword: true,
      emailVerified: true,
    })

    for (const [method, path, body] of [
      ['GET', '/api/rooms'],
      ['POST', '/api/rooms', {}],
      ['GET', '/api/admin/users'],
      ['GET', '/api/admin/settings'],
      ['PATCH', '/api/me', { displayName: 'Root' }],
      ['GET', '/api/auth/sessions'],
      ['DELETE', `/api/auth/sessions/${'0'.repeat(64)}`],
      ['POST', '/api/auth/invites/preview', { token: 'x'.repeat(43) }],
      ['GET', '/api/recordings'],
      ['POST', '/api/join/abc-defg-hjk/info', {}],
    ] as const) {
      guarded(await api.request(method, path, body === undefined ? {} : { body }))
    }

    // The allowlist.
    const me = await api.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.user.mustChangePassword).toBe(true)
    expect((await api.get('/api/config')).status).toBe(200)
    notGuarded(await api.get('/api/health'))
    notGuarded(await api.get('/api/ready'))
    expectApiError(await api.post('/api/auth/password', { body: {} }), 400, 'VALIDATION_FAILED')

    const changed = await api.post('/api/auth/password', {
      body: { currentPassword: ADMIN_PASSWORD, newPassword: NEW_PASSWORD },
    })
    expect(changed.status, changed.text).toBe(200)
    expect(changed.body.user.mustChangePassword).toBe(false)

    for (const path of ['/api/rooms', '/api/admin/users', '/api/auth/sessions']) notGuarded(await api.get(path))
    expect((await api.get('/api/auth/sessions')).status).toBe(200)
    expect((await api.patch('/api/me', { body: { displayName: 'Root' } })).body.user.displayName).toBe('Root')
    expect((await api.post('/api/auth/logout')).status).toBe(204)

    // The old password is gone; the new one works without the guard.
    expectApiError(
      await createClient({ baseUrl: server.baseUrl }).post('/api/auth/login', {
        body: { email: adminEmail, password: ADMIN_PASSWORD },
      }),
      401,
      'AUTH_INVALID_CREDENTIALS',
    )
    const again = await createClient({ baseUrl: server.baseUrl }).post('/api/auth/login', {
      body: { email: adminEmail, password: NEW_PASSWORD },
    })
    expect(again.body.user.mustChangePassword).toBe(false)
  })

  it('can always sign out while the change is pending (also after an operator reset)', async () => {
    const api = createClient({ baseUrl: server.baseUrl })
    // `cli reset-password` puts the account back into the pending state.
    const reset = await runCli(
      ['reset-password', adminEmail],
      { ...serverEnv(), DATABASE_URL: scratch.url },
      `${ADMIN_PASSWORD}\n`,
    )
    expect(reset.code, reset.stderr).toBe(0)
    const login = await api.post('/api/auth/login', { body: { email: adminEmail, password: ADMIN_PASSWORD } })
    expect(login.body.user.mustChangePassword).toBe(true)
    guarded(await api.get('/api/rooms'))
    expect((await api.post('/api/auth/logout')).status).toBe(204)
    expect((await api.get('/api/auth/me')).body.user).toBeNull()
  })
})
