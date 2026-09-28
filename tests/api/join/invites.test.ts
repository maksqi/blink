/**
 * Room invites at join time (docs/API.md §6): everyone except hosts and co-hosts needs a valid, unexpired, unrevoked
 * invite with uses left; uses are consumed atomically, once per new participant row; info never consumes.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { roomInvites, roomMembers } from '../../../server/database/schema'
import { inviteTokenFor } from '../../../server/services/invites/token'
import {
  createClient,
  createRoom,
  createRoomInvite,
  createUser,
  expectApiError,
  loginAs,
  serverEnv,
  testDb,
} from '../_harness'
import { join, joinGuest, joinUser } from '../rooms/_support'

const HOUR = 3_600_000

async function useCount(inviteId: string): Promise<number> {
  const [row] = await testDb().select().from(roomInvites).where(eq(roomInvites.id, inviteId))
  return row!.useCount
}

describe('invites at join time', () => {
  it('requires an invite from guests and from signed-in users who are not hosts or co-hosts', async () => {
    const room = await createRoom(await createUser(), { waitingRoom: false })
    expectApiError((await joinGuest(room, { invite: false })).res, 403, 'ROOM_INVITE_REQUIRED')
    expectApiError((await joinUser(room, { invite: false })).res, 403, 'ROOM_INVITE_REQUIRED')
  })

  it('lets hosts and co-hosts join without an invite', async () => {
    const owner = await createUser()
    const cohost = await createUser()
    const room = await createRoom(owner, { waitingRoom: true })
    await testDb().insert(roomMembers).values({ roomId: room.id, userId: cohost.id })
    expect((await join(await loginAs(owner), room)).status).toBe(200)
    const res = await join(await loginAs(cohost), room)
    expect(res.status, res.text).toBe(200)
    expect(res.body.role).toBe('cohost')
  })

  it('rejects bad, foreign, expired and revoked invites with ROOM_INVITE_INVALID', async () => {
    const room = await createRoom(await createUser(), { waitingRoom: false })
    const other = await createRoom(await createUser())
    const foreign = await createRoomInvite(other)
    const expired = await createRoomInvite(room, { expiresAt: new Date(Date.now() - 1_000) })
    const revoked = await createRoomInvite(room, { revoked: true })
    const unknown = inviteTokenFor(randomUUID(), serverEnv().APP_SECRET)
    const valid = await createRoomInvite(room)
    const bytes = Buffer.from(valid.token, 'base64url')
    bytes[20]! ^= 0x01
    const tampered = bytes.toString('base64url')
    for (const token of [foreign.token, expired.token, revoked.token, unknown, tampered]) {
      expectApiError(await join(createClient(), room, { inviteToken: token, displayName: 'Guest' }), 403, 'ROOM_INVITE_INVALID')
      expectApiError(await createClient().post(`/api/join/${room.slug}/info`, { body: { proof: room.proof, inviteToken: token } }), 403, 'ROOM_INVITE_INVALID')
    }
  })

  it('accepts a valid invite, consumes one use per new participant, and info never consumes', async () => {
    const room = await createRoom(await createUser(), { waitingRoom: false })
    const invite = await createRoomInvite(room, { maxUses: 2, expiresAt: new Date(Date.now() + HOUR) })
    const info = await createClient().post(`/api/join/${room.slug}/info`, { body: { proof: room.proof, inviteToken: invite.token } })
    expect(info.status).toBe(200)
    expect(await useCount(invite.id)).toBe(0)
    expect((await join(createClient(), room, { inviteToken: invite.token, displayName: 'A' })).status).toBe(200)
    expect((await join(await loginAs(await createUser()), room, { inviteToken: invite.token })).status).toBe(200)
    expect(await useCount(invite.id)).toBe(2)
    expectApiError(await join(createClient(), room, { inviteToken: invite.token, displayName: 'C' }), 403, 'ROOM_INVITE_INVALID')
    // info still recognizes the used-up invite (a resuming participant's link), the join decides.
    expect((await createClient().post(`/api/join/${room.slug}/info`, { body: { proof: room.proof, inviteToken: invite.token } })).status).toBe(200)
  })

  it('never exceeds max uses under concurrency', async () => {
    const room = await createRoom(await createUser(), { waitingRoom: false })
    const invite = await createRoomInvite(room, { maxUses: 3 })
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => join(createClient(), room, { inviteToken: invite.token, displayName: `Guest ${i}` })),
    )
    expect(results.filter((res) => res.status === 200)).toHaveLength(3)
    for (const res of results.filter((r) => r.status !== 200)) expectApiError(res, 403, 'ROOM_INVITE_INVALID')
    expect(await useCount(invite.id)).toBe(3)
  })

  it('consumes an invite for a waiting request too, but not when the request is refused', async () => {
    const room = await createRoom(await createUser(), { waitingRoom: true, locked: true })
    const invite = await createRoomInvite(room)
    expectApiError(await join(createClient(), room, { inviteToken: invite.token, displayName: 'Guest' }), 403, 'ROOM_LOCKED')
    expect(await useCount(invite.id)).toBe(0)
    const open = await createRoom(await createUser(), { waitingRoom: true })
    const openInvite = await createRoomInvite(open)
    expect((await join(createClient(), open, { inviteToken: openInvite.token, displayName: 'Guest' })).status).toBe(202)
    expect(await useCount(openInvite.id)).toBe(1)
  })
})
