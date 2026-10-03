/**
 * /api/admin/users through HTTP: list and filters, create (temporary password once or by email, forced change),
 * read, update (rename, disable → out of live calls, role change → sessions rotate, self rules), delete (live
 * meetings, live calls and recording files first), reset password and revoke sessions.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { callParticipants, recordings, sessions, users } from '../../../server/database/schema'
import {
  createAdmin,
  createClient,
  createRoom,
  createUser,
  expectApiError,
  loginAs,
  serverEnv,
  testDb,
  uniqueEmail,
  uniqueName,
  waitForMessage,
} from '../_harness'
import { joinUser, livekitCalls, participantRow, sendWebhook, startMeeting } from '../rooms/_support'
import { ADMIN_USER_KEYS, auditRows, signedInAdmin, sortedKeys } from './_support'

const NEW_PASSWORD = 'harbor-violet-copper-77'

const sessionCount = async (userId: string) =>
  (await testDb().select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId))).length

async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs = 2_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await probe()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error('condition not reached in time')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

describe('GET /api/admin/users', () => {
  it('lists accounts with the documented fields and filters by text, role and status', async () => {
    const { api } = await signedInAdmin()
    const tag = randomBytes(4).toString('hex')
    const active = await createUser({ email: uniqueEmail(`list-${tag}`) })
    const disabled = await createUser({ email: uniqueEmail(`list-${tag}`), disabled: true })
    const admin = await createAdmin({ email: uniqueEmail(`list-${tag}`) })
    await createRoom(active)

    const all = await api.get('/api/admin/users', { query: { q: `list-${tag}` } })
    expect(all.status, all.text).toBe(200)
    expect(all.body).toMatchObject({ page: 1, pageSize: 25, total: 3 })
    expect(all.body.items).toHaveLength(3)
    for (const item of all.body.items) expect(sortedKeys(item)).toEqual(ADMIN_USER_KEYS)
    expect(all.body.items.find((u: { id: string }) => u.id === active.id)).toMatchObject({
      email: active.email,
      role: 'user',
      disabled: false,
      roomCount: 1,
    })

    const ids = async (query: Record<string, string>) =>
      (await api.get('/api/admin/users', { query: { q: `list-${tag}`, ...query } })).body.items
        .map((u: { id: string }) => u.id)
        .sort()
    expect(await ids({ role: 'admin' })).toEqual([admin.id])
    expect(await ids({ status: 'disabled' })).toEqual([disabled.id])
    expect(await ids({ status: 'active', role: 'user' })).toEqual([active.id])

    const paged = await api.get('/api/admin/users', { query: { q: `list-${tag}`, pageSize: 2, page: 2 } })
    expect(paged.body).toMatchObject({ page: 2, pageSize: 2, total: 3 })
    expect(paged.body.items).toHaveLength(1)
  })

  it('rejects invalid queries', async () => {
    const { api } = await signedInAdmin()
    expectApiError(await api.get('/api/admin/users', { query: { pageSize: 101 } }), 400, 'VALIDATION_FAILED')
    expectApiError(await api.get('/api/admin/users', { query: { role: 'owner' } }), 400, 'VALIDATION_FAILED')
    expectApiError(await api.get('/api/admin/users', { query: { status: 'gone' } }), 400, 'VALIDATION_FAILED')
  })
})

describe('POST /api/admin/users', () => {
  it('returns a 16-character temporary password once; the new account must change it', async () => {
    const { api } = await signedInAdmin()
    const email = uniqueEmail('created')
    const res = await api.post('/api/admin/users', {
      body: { email: email.toUpperCase(), displayName: 'Created Person' },
    })
    expect(res.status, res.text).toBe(201)
    expect(res.body.emailed).toBe(false)
    expect(res.body.tempPassword).toMatch(/^\S{16}$/)
    expect(sortedKeys(res.body.user)).toEqual(ADMIN_USER_KEYS)
    expect(res.body.user).toMatchObject({ email, role: 'user', mustChangePassword: true, disabled: false })

    const person = createClient()
    const login = await person.post('/api/auth/login', { body: { email, password: res.body.tempPassword } })
    expect(login.status, login.text).toBe(200)
    expect(login.body.user.mustChangePassword).toBe(true)
    expectApiError(await person.get('/api/rooms'), 403, 'AUTH_PASSWORD_CHANGE_REQUIRED')
    const changed = await person.post('/api/auth/password', {
      body: { currentPassword: res.body.tempPassword, newPassword: NEW_PASSWORD },
    })
    expect(changed.status, changed.text).toBe(200)
    expect((await person.get('/api/rooms')).status).toBe(200)

    // The password is never stored or shown again.
    const again = await api.get(`/api/admin/users/${res.body.user.id}`)
    expect(again.text).not.toContain(res.body.tempPassword)
  })

  it('creates admins and emails the password instead when asked', async () => {
    const { api } = await signedInAdmin()
    const email = uniqueEmail('mailed')
    const res = await api.post('/api/admin/users', {
      body: { email, displayName: 'Mailed Admin', role: 'admin', sendEmail: true },
    })
    expect(res.status, res.text).toBe(201)
    expect(res.body).toMatchObject({ tempPassword: null, emailed: true, user: { role: 'admin' } })
    const mail = await waitForMessage(email)
    expect(mail.Text).toMatch(/\S{16}/)
  })

  it('answers 409 email_taken for an existing address and 400 for invalid input', async () => {
    const { api } = await signedInAdmin()
    const existing = await createUser()
    const taken = await api.post('/api/admin/users', { body: { email: existing.email, displayName: 'Again' } })
    expectApiError(taken, 409, 'CONFLICT')
    expect(taken.body.data.details).toEqual({ reason: 'email_taken' })
    expectApiError(await api.post('/api/admin/users', { body: { email: 'nope', displayName: 'X' } }), 400, 'VALIDATION_FAILED')
    expectApiError(
      await api.post('/api/admin/users', { body: { email: uniqueEmail(), displayName: 'X', role: 'root' } }),
      400,
      'VALIDATION_FAILED',
    )
  })
})

describe('GET /api/admin/users/:id', () => {
  it('returns one account; unknown and malformed ids are 404', async () => {
    const { api } = await signedInAdmin()
    const user = await createUser()
    const res = await api.get(`/api/admin/users/${user.id}`)
    expect(res.status, res.text).toBe(200)
    expect(sortedKeys(res.body)).toEqual(['user'])
    expect(res.body.user).toMatchObject({ id: user.id, email: user.email, roomCount: 0 })
    expectApiError(await api.get('/api/admin/users/01890000-0000-7000-8000-000000000000'), 404, 'NOT_FOUND')
    expectApiError(await api.get(`/api/admin/users/${'-'.repeat(36)}`), 404, 'NOT_FOUND')
  })
})

describe('PATCH /api/admin/users/:id', () => {
  it('renames without touching sessions', async () => {
    const { api } = await signedInAdmin()
    const user = await createUser()
    await loginAs(user)
    const res = await api.patch(`/api/admin/users/${user.id}`, { body: { displayName: '  Renamed   Person ' } })
    expect(res.status, res.text).toBe(200)
    expect(res.body.user.displayName).toBe('Renamed Person')
    expect(await sessionCount(user.id)).toBe(1)
    expectApiError(
      await api.patch(`/api/admin/users/${user.id}`, { body: { displayName: '' } }),
      400,
      'VALIDATION_FAILED',
    )
  })

  it('disabling signs the user out and removes them from a live call within 1 s', async () => {
    const { api } = await signedInAdmin()
    const owner = await createUser()
    const room = await createRoom(owner, { waitingRoom: false })
    await startMeeting(room, owner)
    const joined = await joinUser(room, { expectStatus: 200 })
    expect((await sendWebhook('participant_joined', room, { identity: joined.identity })).status).toBe(200)
    expect((await participantRow(joined.identity))!.status).toBe('joined')

    const started = Date.now()
    const res = await api.patch(`/api/admin/users/${joined.user!.id}`, { body: { disabled: true } })
    expect(res.status, res.text).toBe(200)
    expect(res.body.user.disabled).toBe(true)
    const removal = await waitFor(async () =>
      (await livekitCalls(room.id, 'removeParticipant')).find((call) => call.args[1] === joined.identity),
    )
    expect(Date.parse(removal.at) - started).toBeLessThan(1_000)
    expect((await participantRow(joined.identity))!.status).toBe('left')
    expect(await sessionCount(joined.user!.id)).toBe(0)
    expectApiError(await joined.api.get('/api/rooms'), 401, 'UNAUTHENTICATED')

    const enabled = await api.patch(`/api/admin/users/${joined.user!.id}`, { body: { disabled: false } })
    expect(enabled.body.user.disabled).toBe(false)
  })

  it("a role change signs the target out everywhere and writes the changed fields", async () => {
    const { admin, api } = await signedInAdmin()
    const user = await createUser()
    const userApi = await loginAs(user)
    const res = await api.patch(`/api/admin/users/${user.id}`, { body: { role: 'admin' } })
    expect(res.status, res.text).toBe(200)
    expect(res.body.user.role).toBe('admin')
    expect(await sessionCount(user.id)).toBe(0)
    expectApiError(await userApi.get('/api/auth/sessions'), 401, 'UNAUTHENTICATED')
    const [entry] = await auditRows({ action: 'admin.user_updated', targetId: user.id })
    expect(entry).toMatchObject({ actorUserId: admin.id, details: { fields: ['role'], role: 'admin' } })
  })

  it('refuses to let an admin disable themselves (409 self); unknown ids are 404', async () => {
    const { admin, api } = await signedInAdmin()
    const res = await api.patch(`/api/admin/users/${admin.id}`, { body: { disabled: true } })
    expectApiError(res, 409, 'CONFLICT')
    expect(res.body.data.details).toEqual({ reason: 'self' })
    expectApiError(
      await api.patch('/api/admin/users/01890000-0000-7000-8000-000000000000', { body: { displayName: 'X' } }),
      404,
      'NOT_FOUND',
    )
  })
})

describe('DELETE /api/admin/users/:id', () => {
  it('ends the meetings of their rooms, removes them from other calls and deletes their recording files', async () => {
    const { admin, api } = await signedInAdmin()
    const target = await createUser()
    // A live meeting in the target's own room.
    const ownRoom = await createRoom(target, { waitingRoom: false })
    await startMeeting(ownRoom, target)
    // The target is in someone else's live call.
    const owner = await createUser()
    const otherRoom = await createRoom(owner, { waitingRoom: false })
    await startMeeting(otherRoom, owner)
    const joined = await joinUser(otherRoom, { user: target, expectStatus: 200 })
    // A stored recording of the target's room, with its file on disk.
    const [recording] = await testDb()
      .insert(recordings)
      .values({ roomId: ownRoom.id, createdBy: target.id, status: 'ready', endedAt: new Date() })
      .returning()
    const dir = join(serverEnv().RECORDINGS_DIR!, recording!.id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'recording.blq1'), randomBytes(64))
    await testDb()
      .update(recordings)
      .set({ storageKey: `${recording!.id}/recording.blq1`, sizeBytes: 64 })
      .where(eq(recordings.id, recording!.id))

    const res = await api.delete(`/api/admin/users/${target.id}`)
    expect(res.status, res.text).toBe(204)
    expect(res.text).toBe('')

    expect(await testDb().select().from(users).where(eq(users.id, target.id))).toEqual([])
    expect((await livekitCalls(ownRoom.id, 'deleteRoom')).length).toBeGreaterThanOrEqual(2) // before create, at end
    const removed = await livekitCalls(otherRoom.id, 'removeParticipant')
    expect(removed.map((call) => call.args[1])).toContain(joined.identity)
    const [row] = await testDb().select().from(callParticipants).where(eq(callParticipants.lkIdentity, joined.identity))
    expect(row).toMatchObject({ status: 'left', userId: null })
    expect(existsSync(dir)).toBe(false)

    const [entry] = await auditRows({ action: 'admin.user_deleted', targetId: target.id })
    expect(entry).toMatchObject({ actorUserId: admin.id, details: { email: target.email, role: 'user' } })
    expectApiError(await api.delete(`/api/admin/users/${target.id}`), 404, 'NOT_FOUND')
  })

  it('refuses to delete the own account (409 self)', async () => {
    const { admin, api } = await signedInAdmin()
    const res = await api.delete(`/api/admin/users/${admin.id}`)
    expectApiError(res, 409, 'CONFLICT')
    expect(res.body.data.details).toEqual({ reason: 'self' })
  })
})

describe('POST /api/admin/users/:id/reset-password', () => {
  it('returns a new temporary password, forces a change and signs the user out (body optional)', async () => {
    const { api } = await signedInAdmin()
    const user = await createUser()
    const userApi = await loginAs(user)
    const res = await api.post(`/api/admin/users/${user.id}/reset-password`)
    expect(res.status, res.text).toBe(200)
    expect(res.body).toEqual({ tempPassword: expect.stringMatching(/^\S{16}$/), emailed: false })
    expectApiError(await userApi.get('/api/auth/sessions'), 401, 'UNAUTHENTICATED')

    const person = createClient()
    expectApiError(
      await person.post('/api/auth/login', { body: { email: user.email, password: user.password } }),
      401,
      'AUTH_INVALID_CREDENTIALS',
    )
    const login = await person.post('/api/auth/login', { body: { email: user.email, password: res.body.tempPassword } })
    expect(login.status, login.text).toBe(200)
    expect(login.body.user.mustChangePassword).toBe(true)
  })

  it('emails the password when asked; unknown users are 404', async () => {
    const { api } = await signedInAdmin()
    const user = await createUser()
    const res = await api.post(`/api/admin/users/${user.id}/reset-password`, { body: { sendEmail: true } })
    expect(res.status, res.text).toBe(200)
    expect(res.body).toEqual({ tempPassword: null, emailed: true })
    await waitForMessage(user.email)
    expectApiError(
      await api.post('/api/admin/users/01890000-0000-7000-8000-000000000000/reset-password', { body: {} }),
      404,
      'NOT_FOUND',
    )
    expectApiError(
      await api.post(`/api/admin/users/${user.id}/reset-password`, { body: { sendEmail: 'yes' } }),
      400,
      'VALIDATION_FAILED',
    )
  })
})

describe('POST /api/admin/users/:id/revoke-sessions', () => {
  it('signs the user out everywhere and answers 204', async () => {
    const { api } = await signedInAdmin()
    const user = await createUser({ displayName: uniqueName('Revoked') })
    const first = await loginAs(user)
    await loginAs(user)
    const res = await api.post(`/api/admin/users/${user.id}/revoke-sessions`)
    expect(res.status, res.text).toBe(204)
    expect(await sessionCount(user.id)).toBe(0)
    expectApiError(await first.get('/api/auth/sessions'), 401, 'UNAUTHENTICATED')
    const [entry] = await auditRows({ action: 'admin.user_sessions_revoked', targetId: user.id })
    expect(entry!.details).toEqual({ revoked: 2 })
    expectApiError(
      await api.post('/api/admin/users/01890000-0000-7000-8000-000000000000/revoke-sessions'),
      404,
      'NOT_FOUND',
    )
  })
})
