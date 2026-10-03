/**
 * Every mutating admin route writes exactly one audit entry with its documented action (table-driven; each case runs
 * as a fresh admin, so the entries of that admin are exactly the ones the request wrote). Then GET /api/admin/audit:
 * shape, filters (`action`, `actorUserId`, `q` over the target) and paging.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  type ApiClient,
  type ApiResponse,
  createInvite,
  createRoom,
  createUser,
  expectApiError,
  REPO_ROOT,
  uniqueEmail,
  uniqueName,
} from '../_harness'
import { startMeeting } from '../rooms/_support'
import { AUDIT_KEYS, auditRows, restoreSettings, signedInAdmin, sortedKeys } from './_support'

interface Case {
  route: string
  action: string
  run(api: ApiClient): Promise<{ res: ApiResponse; status: number; targetId?: string }>
}

const CASES: Case[] = [
  {
    route: 'POST /api/admin/users',
    action: 'admin.user_created',
    async run(api) {
      const res = await api.post('/api/admin/users', { body: { email: uniqueEmail('audited'), displayName: 'Audited' } })
      return { res, status: 201, targetId: res.body.user?.id }
    },
  },
  {
    route: 'PATCH /api/admin/users/:id',
    action: 'admin.user_updated',
    async run(api) {
      const user = await createUser()
      return { res: await api.patch(`/api/admin/users/${user.id}`, { body: { role: 'admin' } }), status: 200, targetId: user.id }
    },
  },
  {
    route: 'DELETE /api/admin/users/:id',
    action: 'admin.user_deleted',
    async run(api) {
      const user = await createUser()
      return { res: await api.delete(`/api/admin/users/${user.id}`), status: 204, targetId: user.id }
    },
  },
  {
    route: 'POST /api/admin/users/:id/reset-password',
    action: 'admin.user_password_reset',
    async run(api) {
      const user = await createUser()
      return { res: await api.post(`/api/admin/users/${user.id}/reset-password`), status: 200, targetId: user.id }
    },
  },
  {
    route: 'POST /api/admin/users/:id/revoke-sessions',
    action: 'admin.user_sessions_revoked',
    async run(api) {
      const user = await createUser()
      return { res: await api.post(`/api/admin/users/${user.id}/revoke-sessions`), status: 204, targetId: user.id }
    },
  },
  {
    route: 'POST /api/admin/invites',
    action: 'admin.invite_created',
    async run(api) {
      const res = await api.post('/api/admin/invites', { body: { role: 'user', expiresIn: '24h' } })
      return { res, status: 201, targetId: res.body.id }
    },
  },
  {
    route: 'DELETE /api/admin/invites/:id',
    action: 'admin.invite_revoked',
    async run(api) {
      const invite = await createInvite()
      return { res: await api.delete(`/api/admin/invites/${invite.id}`), status: 204, targetId: invite.id }
    },
  },
  {
    route: 'PUT /api/admin/settings',
    action: 'admin.settings_updated',
    async run(api) {
      return { res: await api.put('/api/admin/settings', { body: { 'limits.maxRoomsPerUser': 9 } }), status: 200 }
    },
  },
  {
    route: 'POST /api/admin/settings/test-email',
    action: 'admin.test_email_sent',
    async run(api) {
      return { res: await api.post('/api/admin/settings/test-email', { body: { to: uniqueEmail('audit-mail') } }), status: 200 }
    },
  },
  {
    route: 'POST /api/admin/rooms/:id/end',
    action: 'admin.room_ended',
    async run(api) {
      const owner = await createUser()
      const room = await createRoom(owner, { waitingRoom: false })
      await startMeeting(room, owner)
      return { res: await api.post(`/api/admin/rooms/${room.id}/end`), status: 204, targetId: room.id }
    },
  },
  {
    route: 'DELETE /api/admin/rooms/:id',
    action: 'admin.room_deleted',
    async run(api) {
      const room = await createRoom(await createUser())
      return { res: await api.delete(`/api/admin/rooms/${room.id}`), status: 204, targetId: room.id }
    },
  },
]

/** Mutating routes owned by the admin workstream (recordings belong to recording-server and audit themselves). */
function mutatingAdminRoutes(): string[] {
  const root = join(REPO_ROOT, 'server/api/admin')
  return (readdirSync(root, { recursive: true }) as string[])
    .filter((file) => file.endsWith('.ts') && !file.startsWith('recordings'))
    .map((file) => {
      const segments = file.replace(/\.ts$/, '').split(/[\\/]/)
      const [, name, method] = segments.pop()!.match(/^(.+)\.(get|post|put|patch|delete)$/)!
      const parts = [...segments, name!].filter((part) => part !== 'index').map((part) => part.replace(/^\[(.+)\]$/, ':$1'))
      return `${method!.toUpperCase()} ${['/api/admin', ...parts].join('/')}`
    })
    .filter((route) => !route.startsWith('GET '))
    .sort()
}

// The settings case changed a setting: put everything back for the files that run after this one.
afterAll(async () => {
  await restoreSettings((await signedInAdmin()).api)
})

describe('audit entries of admin mutations', () => {
  it('covers every mutating admin route', () => {
    expect(CASES.map((c) => c.route).sort()).toEqual(mutatingAdminRoutes())
  })

  it.each(CASES)('$route writes exactly one $action', async (testCase) => {
    const { admin, api } = await signedInAdmin()
    const { res, status, targetId } = await testCase.run(api)
    expect(res.status, res.text).toBe(status)
    const rows = await auditRows({ actorUserId: admin.id })
    expect(rows.map((row) => row.action)).toEqual([testCase.action])
    if (targetId) expect(rows[0]!.targetId).toBe(targetId)
    expect(rows[0]!.ip).toBe(api.ip)
    // Nothing secret in the entry: no temporary passwords, invite tokens or room keys.
    const text = JSON.stringify(rows[0]!.details ?? {})
    for (const secret of [res.body?.tempPassword, res.body?.token].filter(Boolean)) expect(text).not.toContain(secret)
  })
})

describe('GET /api/admin/audit', () => {
  it('returns entries with the documented shape, newest first, filtered by actor', async () => {
    const { admin, api } = await signedInAdmin()
    const first = await createUser()
    const second = await createUser()
    await api.patch(`/api/admin/users/${first.id}`, { body: { displayName: uniqueName('Audited') } })
    await api.post(`/api/admin/users/${second.id}/revoke-sessions`)

    const res = await api.get('/api/admin/audit', { query: { actorUserId: admin.id } })
    expect(res.status, res.text).toBe(200)
    expect(res.body).toMatchObject({ page: 1, pageSize: 25, total: 2 })
    expect(res.body.items.map((e: { action: string }) => e.action)).toEqual([
      'admin.user_sessions_revoked',
      'admin.user_updated',
    ])
    const [entry] = res.body.items
    expect(sortedKeys(entry)).toEqual(AUDIT_KEYS)
    expect(entry).toMatchObject({
      actor: { userId: admin.id, displayName: admin.displayName, participantId: null },
      ip: api.ip,
      targetType: 'user',
      targetId: second.id,
      details: { revoked: 0 },
    })
    expect(Number.isNaN(Date.parse(entry.at))).toBe(false)
  })

  it('filters by exact action, by action domain and by target, and pages', async () => {
    const { admin, api } = await signedInAdmin()
    const target = await createUser()
    await api.patch(`/api/admin/users/${target.id}`, { body: { displayName: uniqueName('One') } })
    await api.patch(`/api/admin/users/${target.id}`, { body: { displayName: uniqueName('Two') } })
    await api.post(`/api/admin/users/${target.id}/revoke-sessions`)

    const query = (extra: Record<string, string | number>) =>
      api.get('/api/admin/audit', { query: { actorUserId: admin.id, ...extra } })
    expect((await query({ action: 'admin.user_updated' })).body.total).toBe(2)
    expect((await query({ action: 'admin' })).body.total).toBe(3)
    expect((await query({ action: 'auth' })).body.total).toBe(0)
    expect((await query({ q: target.id.slice(0, 13) })).body.total).toBe(3)
    expect((await query({ q: 'no-such-target' })).body.total).toBe(0)
    const page = await query({ pageSize: 2, page: 2 })
    expect(page.body).toMatchObject({ page: 2, pageSize: 2, total: 3 })
    expect(page.body.items).toHaveLength(1)
  })

  it('rejects invalid filters', async () => {
    const { api } = await signedInAdmin()
    expectApiError(await api.get('/api/admin/audit', { query: { actorUserId: 'me' } }), 400, 'VALIDATION_FAILED')
    expectApiError(await api.get('/api/admin/audit', { query: { pageSize: 0 } }), 400, 'VALIDATION_FAILED')
  })
})
