/**
 * Room key rotation (docs/API.md §5, docs/SECURITY.md §3.5): owner only, never while a meeting is live, and old links
 * (old proofs) stop working.
 */
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { deriveJoinProof, generateRoomKey } from '../../../app/lib/e2ee'
import { rooms, roomMembers } from '../../../server/database/schema'
import { hashToken } from '../../../server/utils/crypto'
import { createClient, createMeeting, createRoom, createUser, expectApiError, loginAs, testDb } from '../_harness'
import { openSse } from '../join/_sse'
import { joinGuest, startMeeting } from './_support'

describe('PUT /api/rooms/:id/key', () => {
  it('rotates the proof hash and key version; the old proof is then rejected', async () => {
    const owner = await createUser()
    const room = await createRoom(owner)
    const newProof = await deriveJoinProof(generateRoomKey(), room.slug)
    const api = await loginAs(owner)
    const res = await api.put(`/api/rooms/${room.id}/key`, { body: { proof: newProof } })
    expect(res.status, res.text).toBe(200)
    expect(res.body.room.keyVersion).toBe(2)
    const [row] = await testDb().select().from(rooms).where(eq(rooms.id, room.id))
    expect(row!.joinProofHash).toBe(hashToken(newProof))

    const guest = createClient()
    expectApiError(await guest.post(`/api/join/${room.slug}/info`, { body: { proof: room.proof } }), 403, 'ROOM_KEY_INVALID')
    expectApiError(
      await guest.post(`/api/join/${room.slug}`, { body: { proof: room.proof, clientId: 'c'.repeat(22), displayName: 'G' } }),
      403,
      'ROOM_KEY_INVALID',
    )
    expect((await guest.post(`/api/join/${room.slug}/info`, { body: { proof: newProof } })).status).toBe(200)
  })

  it('answers 409 MEETING_LIVE while a meeting is live', async () => {
    const owner = await createUser()
    const room = await createRoom(owner)
    await createMeeting(room)
    const res = await (await loginAs(owner)).put(`/api/rooms/${room.id}/key`, {
      body: { proof: await deriveJoinProof(generateRoomKey(), room.slug) },
    })
    expectApiError(res, 409, 'MEETING_LIVE')
    const [row] = await testDb().select().from(rooms).where(eq(rooms.id, room.id))
    expect(row!.keyVersion).toBe(1)
  })

  it('is owner only', async () => {
    const owner = await createUser()
    const cohost = await createUser()
    const room = await createRoom(owner)
    await testDb().insert(roomMembers).values({ roomId: room.id, userId: cohost.id })
    const body = { proof: await deriveJoinProof(generateRoomKey(), room.slug) }
    expectApiError(await (await loginAs(cohost)).put(`/api/rooms/${room.id}/key`, { body }), 403, 'FORBIDDEN')
    expectApiError(await (await loginAs(await createUser())).put(`/api/rooms/${room.id}/key`, { body }), 404, 'ROOM_NOT_FOUND')
    expectApiError(await createClient().put(`/api/rooms/${room.id}/key`, { body }), 401, 'UNAUTHENTICATED')
  })

  it('closes requests that wait for the next meeting with the old key', async () => {
    const owner = await createUser()
    const room = await createRoom(owner)
    const waiting = await joinGuest(room, { expectStatus: 202 })
    const opened = await openSse(waiting.api, waiting.res.body.requestId)
    expect((await opened.stream!.nextEvent()).kind).toBe('event')
    const rotated = await (await loginAs(owner)).put(`/api/rooms/${room.id}/key`, {
      body: { proof: await deriveJoinProof(generateRoomKey(), room.slug) },
    })
    expect(rotated.status).toBe(200)
    expect(await opened.stream!.nextEvent()).toMatchObject({ kind: 'event', event: 'ended' })
    opened.stream!.close()
  })

  it('works again after the meeting ended', async () => {
    const owner = await createUser()
    const room = await createRoom(owner)
    const host = await startMeeting(room, owner)
    expect((await host.api.post(`/api/calls/${room.id}/end`)).status).toBe(204)
    const res = await host.api.put(`/api/rooms/${room.id}/key`, { body: { proof: await deriveJoinProof(generateRoomKey(), room.slug) } })
    expect(res.status, res.text).toBe(200)
  })
})
