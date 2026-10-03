/**
 * Last-admin protection through the admin API, on a private database and server where this file controls every
 * admin: the last enabled admin cannot be demoted, disabled or deleted, also when two admins act at the same time.
 * (The service-level rules and row locks are covered by tests/api/auth/last-admin.test.ts.)
 */
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sessions, users } from '../../../server/database/schema'
import { sessionCookieName } from '../../../server/utils/cookies'
import { hashToken, randomToken } from '../../../server/utils/crypto'
import {
  type ApiClient,
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

let scratch: Awaited<ReturnType<typeof createScratchDatabase>>
let server: TestServer
let client: postgres.Sql
let db: ReturnType<typeof drizzle>

beforeAll(async () => {
  scratch = await createScratchDatabase('adminlast')
  const env = { ...serverEnv(), DATABASE_URL: scratch.url }
  const migrated = await runCli(['migrate'], env)
  expect(migrated.code, migrated.stderr).toBe(0)
  server = await startTestServer(env, { logFile: join(REPO_ROOT, 'test-results', 'api-admin-last-admin.log') })
  client = postgres(scratch.url, { max: 2, idle_timeout: 2, onnotice: () => {} })
  db = drizzle({ client, casing: 'snake_case' })
})

afterAll(async () => {
  await server?.stop()
  await client?.end({ timeout: 2 })
  await scratch?.drop()
})

beforeEach(async () => {
  await db.delete(users)
})

interface Admin {
  id: string
  api: ApiClient
}

/** An admin row in the private database plus a client holding a session on the private server. */
async function admin(options: { disabled?: boolean } = {}): Promise<Admin> {
  const [row] = await db
    .insert(users)
    .values({
      email: uniqueEmail('last-admin'),
      displayName: 'Admin',
      role: 'admin',
      emailVerifiedAt: new Date(),
      disabledAt: options.disabled ? new Date() : null,
    })
    .returning()
  const token = randomToken()
  const now = new Date()
  await db.insert(sessions).values({
    id: hashToken(token),
    userId: row!.id,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + 86_400_000),
    userAgent: 'api-test',
  })
  const api = createClient({ baseUrl: server.baseUrl }).setCookie(sessionCookieName(false), token)
  return { id: row!.id, api }
}

async function enabledAdmins(): Promise<string[]> {
  const rows = await db.select().from(users)
  return rows
    .filter((row) => row.role === 'admin' && row.disabledAt === null)
    .map((row) => row.id)
    .sort()
}

function expectLastAdmin(res: ApiResponse): void {
  expectApiError(res, 409, 'CONFLICT')
  expect(res.body.data.details).toEqual({ reason: 'last_admin' })
}

/** One request won; the other lost on the last-admin rule, or (if it started after the winner signed it out) on 401. */
function expectOneWinner(results: ApiResponse[], okStatus: number): void {
  const won = results.filter((res) => res.status === okStatus)
  const lost = results.filter((res) => res.status !== okStatus)
  expect(won, results.map((res) => res.text).join('\n')).toHaveLength(1)
  expect(lost).toHaveLength(1)
  if (lost[0]!.status === 409) expectLastAdmin(lost[0]!)
  else expectApiError(lost[0]!, 401, 'UNAUTHENTICATED')
}

describe('the last enabled admin', () => {
  it('cannot demote itself (disabled admins do not count)', async () => {
    const only = await admin()
    await admin({ disabled: true })
    expectLastAdmin(await only.api.patch(`/api/admin/users/${only.id}`, { body: { role: 'user' } }))
    expect(await enabledAdmins()).toEqual([only.id])
  })

  it('cannot disable or delete itself either (self wins over last_admin)', async () => {
    const only = await admin()
    const disable = await only.api.patch(`/api/admin/users/${only.id}`, { body: { disabled: true } })
    expectApiError(disable, 409, 'CONFLICT')
    expect(disable.body.data.details).toEqual({ reason: 'self' })
    const remove = await only.api.delete(`/api/admin/users/${only.id}`)
    expectApiError(remove, 409, 'CONFLICT')
    expect(remove.body.data.details).toEqual({ reason: 'self' })
    expect(await enabledAdmins()).toEqual([only.id])
  })

  it('is unprotected while another enabled admin exists; then the other one is the last', async () => {
    const [a, b] = [await admin(), await admin()]
    const demoted = await a.api.patch(`/api/admin/users/${b.id}`, { body: { role: 'user' } })
    expect(demoted.status, demoted.text).toBe(200)
    expectLastAdmin(await a.api.patch(`/api/admin/users/${a.id}`, { body: { role: 'user' } }))
    expect(await enabledAdmins()).toEqual([a.id])
  })
})

describe('concurrent admin changes', () => {
  it('two admins demoting themselves at once: exactly one wins', async () => {
    const [a, b] = [await admin(), await admin()]
    const results = await Promise.all([
      a.api.patch(`/api/admin/users/${a.id}`, { body: { role: 'user' } }),
      b.api.patch(`/api/admin/users/${b.id}`, { body: { role: 'user' } }),
    ])
    // Self-demotion only rotates the caller's own session, so both requests are authenticated: the lock decides.
    expect(results.map((res) => res.status).sort()).toEqual([200, 409])
    expectLastAdmin(results.find((res) => res.status === 409)!)
    expect(await enabledAdmins()).toHaveLength(1)
  })

  it('two admins demoting each other at once: one admin remains', async () => {
    const [a, b] = [await admin(), await admin()]
    const results = await Promise.all([
      a.api.patch(`/api/admin/users/${b.id}`, { body: { role: 'user' } }),
      b.api.patch(`/api/admin/users/${a.id}`, { body: { role: 'user' } }),
    ])
    expectOneWinner(results, 200)
    expect(await enabledAdmins()).toHaveLength(1)
  })

  it('two admins disabling each other at once: one admin remains', async () => {
    const [a, b] = [await admin(), await admin()]
    const results = await Promise.all([
      a.api.patch(`/api/admin/users/${b.id}`, { body: { disabled: true } }),
      b.api.patch(`/api/admin/users/${a.id}`, { body: { disabled: true } }),
    ])
    expectOneWinner(results, 200)
    expect(await enabledAdmins()).toHaveLength(1)
  })

  it('two admins deleting each other at once: one admin remains', async () => {
    const [a, b] = [await admin(), await admin()]
    const results = await Promise.all([a.api.delete(`/api/admin/users/${b.id}`), b.api.delete(`/api/admin/users/${a.id}`)])
    expectOneWinner(results, 204)
    expect(await enabledAdmins()).toHaveLength(1)
  })
})
