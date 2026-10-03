/**
 * /api/admin/rooms through HTTP: live counts from the (fake) LiveKit with a database fallback when LiveKit is down,
 * end and delete through the meeting service (LiveKit `deleteRoom`, meeting ended, waiting requests closed), meeting
 * history, and strict response shapes without keys, proofs, epochs or tokens.
 */
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { callParticipants, meetings, rooms } from '../../../server/database/schema'
import {
  createClient,
  createGuestSession,
  createMeeting,
  createParticipant,
  createRoom,
  createRoomInvite,
  createUser,
  expectApiError,
  loginAs,
  testDb,
  type TestRoom,
  type TestServer,
  type TestUser,
  uniqueName,
} from '../_harness'
import { joinUser, livekitCalls, participantRow, sendWebhook, startMeeting } from '../rooms/_support'
import { ADMIN_ROOM_KEYS, auditRows, MEETING_KEYS, signedInAdmin, sortedKeys, startAdminServer } from './_support'

interface LiveRoom {
  owner: TestUser
  room: TestRoom
  meetingId: string
  /** Everything secret the join produced: none of it may appear in admin answers. */
  secrets: string[]
}

/** A room whose owner joined through the API (so the fake LiveKit room exists) and is `joined` in LiveKit. */
async function liveRoom(name = uniqueName('Admin room')): Promise<LiveRoom> {
  const owner = await createUser()
  const room = await createRoom(owner, { name, waitingRoom: false })
  const joined = await startMeeting(room, owner)
  expect((await sendWebhook('participant_joined', room, { identity: joined.identity })).status).toBe(200)
  const row = await participantRow(joined.identity)
  const [meeting] = await testDb().select().from(meetings).where(eq(meetings.id, row!.meetingId!))
  const invite = await createRoomInvite(room)
  return {
    owner,
    room,
    meetingId: meeting!.id,
    secrets: [room.key, room.proof, room.joinProofHash, joined.res.body.token, meeting!.epoch, invite.token],
  }
}

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys)
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => [key, ...allKeys(item)])
  }
  return []
}

async function findRoom(api: ReturnType<typeof createClient>, room: { id: string; name: string }) {
  const res = await api.get('/api/admin/rooms', { query: { q: room.name } })
  expect(res.status, res.text).toBe(200)
  return { res, item: res.body.items.find((item: { id: string }) => item.id === room.id) }
}

describe('GET /api/admin/rooms', () => {
  it('shows live rooms with LiveKit participant counts and idle rooms as not live', async () => {
    const { api } = await signedInAdmin()
    const live = await liveRoom()
    // A `joined` row LiveKit does not know about: the count must come from LiveKit, not from the database.
    await createParticipant({ room: live.room, meeting: { id: live.meetingId }, status: 'joined' })
    const idle = await createRoom(await createUser(), { name: uniqueName('Idle room') })

    const { item } = await findRoom(api, live.room)
    expect(item).toMatchObject({
      id: live.room.id,
      slug: live.room.slug,
      name: live.room.name,
      owner: { id: live.owner.id, displayName: live.owner.displayName, email: live.owner.email },
      live: true,
      participantCount: 1,
      ephemeral: false,
    })
    expect(item.lastActiveAt).not.toBeNull()
    const listed = await livekitCalls(live.room.id, 'listRooms')
    expect(listed.length).toBeGreaterThan(0)

    const { item: idleItem } = await findRoom(api, idle)
    expect(idleItem).toMatchObject({ live: false, participantCount: 0, lastActiveAt: null })
  })

  it('searches by owner email, puts live rooms first and pages', async () => {
    const { api } = await signedInAdmin()
    const live = await liveRoom()
    await createRoom(live.owner, { name: uniqueName('Older idle') })
    await createRoom(live.owner, { name: uniqueName('Newer idle') })
    const res = await api.get('/api/admin/rooms', { query: { q: live.owner.email, pageSize: 2 } })
    expect(res.status, res.text).toBe(200)
    expect(res.body).toMatchObject({ page: 1, pageSize: 2, total: 3 })
    expect(res.body.items[0]).toMatchObject({ id: live.room.id, live: true })
    const second = await api.get('/api/admin/rooms', { query: { q: live.owner.email, pageSize: 2, page: 2 } })
    expect(second.body.items).toHaveLength(1)
    expect(second.body.items[0].live).toBe(false)
  })

  it('answers with exactly the AdminRoom fields and no keys, proofs, epochs or tokens', async () => {
    const { api } = await signedInAdmin()
    const live = await liveRoom()
    const { res, item } = await findRoom(api, live.room)
    expect(sortedKeys(res.body)).toEqual(['items', 'page', 'pageSize', 'total'])
    expect(sortedKeys(item)).toEqual(ADMIN_ROOM_KEYS)
    expect(sortedKeys(item.owner)).toEqual(['displayName', 'email', 'id'])
    const meetingsRes = await api.get(`/api/admin/rooms/${live.room.id}/meetings`)
    for (const answer of [res, meetingsRes]) {
      for (const secret of live.secrets) expect(answer.text).not.toContain(secret)
      expect(allKeys(answer.body).filter((key) => /proof|epoch|token|password|key|chat|media/i.test(key))).toEqual([])
    }
  })

  it('hides deleted rooms', async () => {
    const { api } = await signedInAdmin()
    const room = await createRoom(await createUser(), { name: uniqueName('Gone room'), deletedAt: new Date() })
    const { item } = await findRoom(api, room)
    expect(item).toBeUndefined()
  })
})

describe('when LiveKit cannot be reached', () => {
  let server: TestServer

  beforeAll(async () => {
    // A real LiveKit client against a closed port: every RoomService call fails.
    server = await startAdminServer('rooms-livekit-down', { LIVEKIT_URL: 'http://127.0.0.1:9' })
  })

  afterAll(async () => {
    await server?.stop()
  })

  it('still lists rooms: live from the meeting row, counts from joined rows', async () => {
    const owner = await createUser()
    const room = await createRoom(owner, { name: uniqueName('Fallback room') })
    const meeting = await createMeeting(room)
    await createParticipant({ room, meeting, status: 'joined' })
    await createParticipant({ room, meeting, status: 'joined' })
    await createParticipant({ room, meeting, status: 'waiting' })
    const idle = await createRoom(owner, { name: uniqueName('Fallback idle') })

    const { admin } = await signedInAdmin()
    const api = await loginAs(admin, createClient({ baseUrl: server.baseUrl }))
    const { item } = await findRoom(api, room)
    expect(item).toMatchObject({ live: true, participantCount: 2 })
    const { item: idleItem } = await findRoom(api, idle)
    expect(idleItem).toMatchObject({ live: false, participantCount: 0 })
  })
})

describe('POST /api/admin/rooms/:id/end', () => {
  it('ends the live meeting through LiveKit deleteRoom, closes waiting requests and audits', async () => {
    const { admin, api } = await signedInAdmin()
    const live = await liveRoom()
    const guest = await createGuestSession(live.room)
    const waiting = await createParticipant({
      room: live.room,
      meeting: { id: live.meetingId },
      guestSessionId: guest.id,
      status: 'waiting',
    })
    const deletesBefore = (await livekitCalls(live.room.id, 'deleteRoom')).length

    const res = await api.post(`/api/admin/rooms/${live.room.id}/end`)
    expect(res.status, res.text).toBe(204)
    expect((await livekitCalls(live.room.id, 'deleteRoom')).length).toBe(deletesBefore + 1)
    const [meeting] = await testDb().select().from(meetings).where(eq(meetings.id, live.meetingId))
    expect(meeting!.endedAt).not.toBeNull()
    const [request] = await testDb().select().from(callParticipants).where(eq(callParticipants.id, waiting.id))
    expect(request!.status).toBe('left')
    const [room] = await testDb().select().from(rooms).where(eq(rooms.id, live.room.id))
    expect(room!.deletedAt).toBeNull()

    const { item } = await findRoom(api, live.room)
    expect(item).toMatchObject({ live: false, participantCount: 0 })
    const [entry] = await auditRows({ action: 'admin.room_ended', targetId: live.room.id })
    expect(entry).toMatchObject({ actorUserId: admin.id, targetType: 'room', details: { name: live.room.name } })
  })

  it('answers 409 not_live without a live meeting and 404 for unknown or deleted rooms', async () => {
    const { api } = await signedInAdmin()
    const idle = await createRoom(await createUser())
    const res = await api.post(`/api/admin/rooms/${idle.id}/end`)
    expectApiError(res, 409, 'CONFLICT')
    expect(res.body.data.details).toEqual({ reason: 'not_live' })
    expectApiError(await api.post('/api/admin/rooms/01890000-0000-7000-8000-000000000000/end'), 404, 'NOT_FOUND')
    const deleted = await createRoom(await createUser(), { deletedAt: new Date() })
    expectApiError(await api.post(`/api/admin/rooms/${deleted.id}/end`), 404, 'NOT_FOUND')
    expect(await auditRows({ action: 'admin.room_ended', targetId: idle.id })).toEqual([])
  })
})

describe('DELETE /api/admin/rooms/:id', () => {
  it('soft-deletes the room, ends its live meeting and audits', async () => {
    const { admin, api } = await signedInAdmin()
    const live = await liveRoom()
    const deletesBefore = (await livekitCalls(live.room.id, 'deleteRoom')).length
    const res = await api.delete(`/api/admin/rooms/${live.room.id}`)
    expect(res.status, res.text).toBe(204)
    const [room] = await testDb().select().from(rooms).where(eq(rooms.id, live.room.id))
    expect(room!.deletedAt).not.toBeNull()
    const [meeting] = await testDb().select().from(meetings).where(eq(meetings.id, live.meetingId))
    expect(meeting!.endedAt).not.toBeNull()
    expect((await livekitCalls(live.room.id, 'deleteRoom')).length).toBe(deletesBefore + 1)
    expect((await findRoom(api, live.room)).item).toBeUndefined()

    const [entry] = await auditRows({ action: 'admin.room_deleted', targetId: live.room.id })
    expect(entry).toMatchObject({ actorUserId: admin.id, targetType: 'room' })
    expectApiError(await api.delete(`/api/admin/rooms/${live.room.id}`), 404, 'NOT_FOUND')
    expectApiError(await api.delete('/api/admin/rooms/not-a-room'), 404, 'NOT_FOUND')
    // The owner's link stops working.
    const joinAgain = await joinUser(live.room, { user: live.owner, invite: false })
    expectApiError(joinAgain.res, 404, 'ROOM_NOT_FOUND')
  })
})

describe('GET /api/admin/rooms/:id/meetings', () => {
  it('lists meeting summaries newest first, also for deleted rooms', async () => {
    const { api } = await signedInAdmin()
    const room = await createRoom(await createUser())
    const older = await createMeeting(room, {
      startedAt: new Date(Date.now() - 3 * 3_600_000),
      endedAt: new Date(Date.now() - 2 * 3_600_000),
    })
    const newer = await createMeeting(room, { startedAt: new Date(Date.now() - 600_000) })
    const res = await api.get(`/api/admin/rooms/${room.id}/meetings`)
    expect(res.status, res.text).toBe(200)
    expect(res.body).toMatchObject({ page: 1, pageSize: 25, total: 2 })
    expect(res.body.items.map((m: { id: string }) => m.id)).toEqual([newer.id, older.id])
    for (const item of res.body.items) expect(sortedKeys(item)).toEqual(MEETING_KEYS)
    expect(res.body.items[0].endedAt).toBeNull()
    expect(res.text).not.toContain(newer.epoch)

    await testDb().update(rooms).set({ deletedAt: new Date() }).where(eq(rooms.id, room.id))
    expect((await api.get(`/api/admin/rooms/${room.id}/meetings`)).body.total).toBe(2)
    expectApiError(await api.get('/api/admin/rooms/01890000-0000-7000-8000-000000000000/meetings'), 404, 'NOT_FOUND')
  })
})
