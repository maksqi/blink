/**
 * Meetings (docs/ARCHITECTURE.md §6.3): the first admitted join creates the meeting (fresh epoch) and the LiveKit room;
 * concurrent first joins still produce one meeting and one createRoom.
 */
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { callParticipants, meetings, roomMembers } from '../../../server/database/schema'
import { createRoom, createUser, loginAs, testDb } from '../_harness'
import { join, joinGuest, livekitCalls, requestRow, startMeeting, usesFakeLivekit } from '../rooms/_support'

async function meetingsOf(roomId: string) {
  return testDb().select().from(meetings).where(eq(meetings.roomId, roomId))
}

describe('meetings', () => {
  it('creates exactly one meeting and one LiveKit room for concurrent first joins', async () => {
    const owner = await createUser()
    const room = await createRoom(owner, { waitingRoom: false })
    const cohosts = await Promise.all([createUser(), createUser(), createUser()])
    await testDb()
      .insert(roomMembers)
      .values(cohosts.map((user) => ({ roomId: room.id, userId: user.id })))
    const clients = await Promise.all([owner, ...cohosts].map((user) => loginAs(user)))
    const results = await Promise.all([
      ...clients.map((api) => join(api, room)),
      joinGuest(room).then((joined) => joined.res),
      joinGuest(room).then((joined) => joined.res),
    ])
    for (const res of results) expect(res.status, res.text).toBe(200)
    const epochs = new Set(results.map((res) => res.body.epoch as string))
    expect(epochs.size).toBe(1)
    expect([...epochs][0]).toMatch(/^[A-Za-z0-9_-]{22}$/)
    const rows = await meetingsOf(room.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.epoch).toBe([...epochs][0])
    if (usesFakeLivekit()) {
      expect(await livekitCalls(room.id, 'createRoom')).toHaveLength(1)
      expect(rows[0]!.livekitSid).toMatch(/^RM_/)
    }
  })

  it('starts a new meeting with a new epoch after the previous one ended', async () => {
    const owner = await createUser()
    const room = await createRoom(owner)
    const first = await startMeeting(room, owner)
    expect((await first.api.post(`/api/calls/${room.id}/end`)).status).toBe(204)
    const second = await startMeeting(room, owner)
    expect(second.res.body.epoch).not.toBe(first.res.body.epoch)
    const rows = await meetingsOf(room.id)
    expect(rows).toHaveLength(2)
    expect(rows.filter((m) => m.endedAt === null)).toHaveLength(1)
    if (usesFakeLivekit()) expect(await livekitCalls(room.id, 'createRoom')).toHaveLength(2)
  })

  it('lets people wait before the meeting starts and attaches them to it', async () => {
    const owner = await createUser()
    const room = await createRoom(owner, { waitingRoom: true })
    const guest = await joinGuest(room, { expectStatus: 202 })
    expect((await requestRow(guest.res.body.requestId))!.meetingId).toBeNull()
    expect(await meetingsOf(room.id)).toHaveLength(0)
    const host = await startMeeting(room, owner)
    const [meeting] = await meetingsOf(room.id)
    expect((await requestRow(guest.res.body.requestId))!.meetingId).toBe(meeting!.id)
    const lobby = await host.api.get(`/api/calls/${room.id}/lobby`)
    expect(lobby.body.items.map((entry: { requestId: string }) => entry.requestId)).toEqual([guest.res.body.requestId])
  })

  it('lets an invited participant start the meeting when there is no waiting room', async () => {
    const room = await createRoom(await createUser(), { waitingRoom: false })
    const guest = await joinGuest(room, { expectStatus: 200 })
    const [meeting] = await meetingsOf(room.id)
    expect(guest.res.body.epoch).toBe(meeting!.epoch)
    const [row] = await testDb().select().from(callParticipants).where(eq(callParticipants.lkIdentity, guest.identity))
    expect(row).toMatchObject({ status: 'admitted', roomRole: 'participant', meetingId: meeting!.id })
  })
})
