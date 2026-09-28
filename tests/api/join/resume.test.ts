/**
 * Resume (docs/API.md §6): the same session or guest session with the same clientId in the same live meeting gets a
 * new token for the same identity, without the lobby and without using an invite; nothing else resumes.
 */
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { callParticipants, roomInvites } from '../../../server/database/schema'
import { createRoom, createRoomInvite, createUser, expectApiError, loginAs, testDb } from '../_harness'
import { join, joinGuest, joinUser, participantRow, sendWebhook, startMeeting } from '../rooms/_support'

async function rowsOfRoom(roomId: string) {
  return testDb().select().from(callParticipants).where(eq(callParticipants.roomId, roomId))
}

describe('resume', () => {
  it('reuses the row and identity for the same session and clientId, without an invite', async () => {
    const owner = await createUser()
    const room = await createRoom(owner, { waitingRoom: true })
    const host = await startMeeting(room, owner)
    const user = await createUser()
    const invite = await createRoomInvite(room, { maxUses: 1 })
    const api = await loginAs(user)
    const waiting = await join(api, room, { clientId: 'tab-one-0123456789ab', inviteToken: invite.token })
    expect(waiting.status).toBe(202)
    expect((await host.api.post(`/api/calls/${room.id}/lobby/${waiting.body.requestId}/admit`)).status).toBe(204)

    const resumed = await join(api, room, { clientId: 'tab-one-0123456789ab' })
    expect(resumed.status, resumed.text).toBe(200)
    const row = await participantRow(resumed.body.identity)
    expect(row!.id).toBe(waiting.body.requestId)
    expect(row!.status).toBe('admitted')
    const [inviteRow] = await testDb().select().from(roomInvites).where(eq(roomInvites.id, invite.id))
    expect(inviteRow!.useCount).toBe(1)
    expect((await rowsOfRoom(room.id)).filter((r) => r.userId === user.id)).toHaveLength(1)

    // A resumed host gets the same identity too.
    const hostAgain = await join(host.api, room, { clientId: host.clientId })
    expect(hostAgain.body.identity).toBe(host.identity)
  })

  it('treats another tab (clientId) as a new participant', async () => {
    const owner = await createUser()
    const room = await createRoom(owner, { waitingRoom: false })
    await startMeeting(room, owner)
    const first = await joinUser(room, { expectStatus: 200 })
    expectApiError(await join(first.api, room, {}), 403, 'ROOM_INVITE_REQUIRED')
    const second = await join(first.api, room, { inviteToken: (await createRoomInvite(room)).token })
    expect(second.status).toBe(200)
    expect(second.body.identity).not.toBe(first.identity)
  })

  it('resumes guests by guest cookie and clientId', async () => {
    const owner = await createUser()
    const room = await createRoom(owner, { waitingRoom: false })
    await startMeeting(room, owner)
    const guest = await joinGuest(room, { expectStatus: 200 })
    const again = await join(guest.api, room, { clientId: guest.clientId, displayName: 'Other name' })
    expect(again.status).toBe(200)
    expect(again.body.identity).toBe(guest.identity)
  })

  it('resumes a reload shortly after the old connection left, but not later', async () => {
    const owner = await createUser()
    const room = await createRoom(owner, { waitingRoom: true })
    const host = await startMeeting(room, owner)
    const guest = await joinGuest(room, { expectStatus: 202 })
    await host.api.post(`/api/calls/${room.id}/lobby/${guest.res.body.requestId}/admit`)
    const row = await testDb().select().from(callParticipants).where(eq(callParticipants.id, guest.res.body.requestId))
    const identity = row[0]!.lkIdentity
    const joinedAtMs = Date.now() - 5_000
    expect((await sendWebhook('participant_joined', room, { identity, joinedAtMs })).status).toBe(200)
    expect((await sendWebhook('participant_left', room, { identity, joinedAtMs })).status).toBe(200)
    expect((await participantRow(identity))!.status).toBe('left')

    const reload = await join(guest.api, room, { clientId: guest.clientId })
    expect(reload.status, reload.text).toBe(200)
    expect(reload.body.identity).toBe(identity)

    await sendWebhook('participant_joined', room, { identity, joinedAtMs: Date.now() })
    await sendWebhook('participant_left', room, { identity, joinedAtMs: (await participantRow(identity))!.joinedAt!.getTime() })
    await testDb()
      .update(callParticipants)
      .set({ leftAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(callParticipants.lkIdentity, identity))
    const late = await join(guest.api, room, { clientId: guest.clientId })
    expectApiError(late, 403, 'ROOM_INVITE_REQUIRED')
  })

  it('reuses a pending request on reload instead of queueing twice', async () => {
    const owner = await createUser()
    const room = await createRoom(owner, { waitingRoom: true })
    const guest = await joinGuest(room, { expectStatus: 202 })
    const again = await join(guest.api, room, { clientId: guest.clientId })
    expect(again.status).toBe(202)
    expect(again.body.requestId).toBe(guest.res.body.requestId)
  })

  it('never resumes rows of an older meeting', async () => {
    const owner = await createUser()
    const room = await createRoom(owner, { waitingRoom: true })
    const host = await startMeeting(room, owner)
    const guest = await joinGuest(room, { expectStatus: 202 })
    await host.api.post(`/api/calls/${room.id}/lobby/${guest.res.body.requestId}/admit`)
    await host.api.post(`/api/calls/${room.id}/end`)
    await startMeeting(room, owner)
    expectApiError(await join(guest.api, room, { clientId: guest.clientId }), 403, 'ROOM_INVITE_REQUIRED')
    const fresh = await joinGuest(room, { api: guest.api, extra: { clientId: guest.clientId } })
    expect(fresh.res.status).toBe(202)
  })

  it('never resumes a removed participant', async () => {
    const owner = await createUser()
    const room = await createRoom(owner, { waitingRoom: false })
    const host = await startMeeting(room, owner)
    const guest = await joinGuest(room, { expectStatus: 200 })
    await host.api.post(`/api/calls/${room.id}/participants/${guest.identity}/remove`)
    expectApiError(await join(guest.api, room, { clientId: guest.clientId }), 403, 'ROOM_INVITE_REQUIRED')
    const retry = await joinGuest(room, { api: guest.api, extra: { clientId: guest.clientId } })
    expectApiError(retry.res, 403, 'JOIN_REMOVED')
  })
})
