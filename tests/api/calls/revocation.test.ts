/**
 * In-process service tests against the test database with an injected fake LiveKit adapter: `user.revoked` handling
 * (removeUserFromLiveCalls) and rooms maintenance (stale waiting requests, stale meetings, idle instant meetings).
 */
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { callParticipants, meetings, rooms } from '../../../server/database/schema'
import { removeUserFromLiveCalls } from '../../../server/services/calls/revocation'
import { createFakeRoomService, type FakeRoomService } from '../../../server/services/livekit/fake-room-service'
import { setRoomServiceForTesting } from '../../../server/services/livekit/room-service'
import { closeStaleWaiting } from '../../../server/services/lobby/lobby'
import { archiveIdleEphemeralRooms, reconcileLiveMeetings } from '../../../server/services/meetings/maintenance'
import { subscribeTo } from '../../../server/utils/event-bus'
import { createMeeting, createParticipant, createRoom, createUser, testDb, useServerEnvInProcess } from '../_harness'

useServerEnvInProcess()

let fake: FakeRoomService
beforeAll(() => {
  fake = createFakeRoomService()
  setRoomServiceForTesting(fake)
})
afterAll(() => setRoomServiceForTesting())

const MINUTE = 60_000
const status = async (id: string) =>
  (await testDb().select({ status: callParticipants.status }).from(callParticipants).where(eq(callParticipants.id, id)))[0]!.status

describe('user.revoked', () => {
  it('removes the user from live calls, revokes their tokens and closes their requests', async () => {
    const user = await createUser()
    const room = await createRoom(await createUser())
    const meeting = await createMeeting(room)
    await fake.createRoom({ name: room.id, maxParticipants: 25, emptyTimeoutSec: 300, departureTimeoutSec: 20, metadata: '{}' })
    const joined = await createParticipant({ room, meeting, userId: user.id, status: 'joined' })
    const waiting = await createParticipant({ room, meeting, userId: user.id, status: 'waiting' })
    const earlier = await createParticipant({ room, meeting, userId: user.id, status: 'removed' })
    const bystander = await createParticipant({ room, meeting, status: 'joined' })
    const decided: string[] = []
    const stop = subscribeTo('lobby.decided', (event) => {
      decided.push(`${event.requestId}:${event.decision}`)
    })
    try {
      expect(await removeUserFromLiveCalls(user.id)).toBe(2)
    } finally {
      stop()
    }
    expect(await status(joined.id)).toBe('left')
    expect(await status(waiting.id)).toBe('left')
    expect(await status(earlier.id)).toBe('removed')
    expect(await status(bystander.id)).toBe('joined')
    const removals = fake.calls.filter((c) => c.method === 'removeParticipant' && c.args[0] === room.id)
    expect(removals.map((c) => c.args[1])).toEqual([joined.lkIdentity])
    expect(Date.parse(removals[0]!.args[2].revokeTokensIssuedBefore)).toBeGreaterThan(Date.now())
    expect(decided).toContain(`${waiting.id}:ended`)
  })
})

describe('rooms maintenance', () => {
  it('closes waiting requests older than 1 h', async () => {
    const room = await createRoom(await createUser())
    const old = await createParticipant({ room, meeting: null, status: 'waiting' })
    const fresh = await createParticipant({ room, meeting: null, status: 'waiting' })
    await testDb().update(callParticipants).set({ requestedAt: new Date(Date.now() - 61 * MINUTE) }).where(eq(callParticipants.id, old.id))
    expect(await closeStaleWaiting(new Date(), room.id)).toBe(1)
    expect(await status(old.id)).toBe('left')
    expect(await status(fresh.id)).toBe('waiting')
  })

  it('ends live meetings whose LiveKit room is gone, never young ones or ones LiveKit still has', async () => {
    const make = async (options: { sid: string | null; ageMs: number; inLivekit: boolean }) => {
      const room = await createRoom(await createUser())
      const meeting = await createMeeting(room, { startedAt: new Date(Date.now() - options.ageMs) })
      let sid = options.sid
      if (options.inLivekit) {
        sid = (await fake.createRoom({ name: room.id, maxParticipants: 2, emptyTimeoutSec: 1, departureTimeoutSec: 1, metadata: '' })).sid
      }
      await testDb().update(meetings).set({ livekitSid: sid }).where(eq(meetings.id, meeting.id))
      const row = await createParticipant({ room, meeting, status: 'joined' })
      return { room, meeting, row }
    }
    const gone = await make({ sid: `RM_${randomBytes(4).toString('hex')}`, ageMs: 10 * MINUTE, inLivekit: false })
    const alive = await make({ sid: null, ageMs: 10 * MINUTE, inLivekit: true })
    const young = await make({ sid: `RM_${randomBytes(4).toString('hex')}`, ageMs: 30_000, inLivekit: false })
    const unmanaged = await make({ sid: null, ageMs: 10 * MINUTE, inLivekit: false })
    const scope = { roomIds: [gone, alive, young, unmanaged].map((m) => m.room.id) }
    expect(await reconcileLiveMeetings(new Date(), scope)).toBe(1)
    const endedAt = async (id: string) => (await testDb().select().from(meetings).where(eq(meetings.id, id)))[0]!.endedAt
    expect(await endedAt(gone.meeting.id)).not.toBeNull()
    expect(await status(gone.row.id)).toBe('left')
    for (const kept of [alive, young, unmanaged]) expect(await endedAt(kept.meeting.id)).toBeNull()
  })

  it('archives instant meetings that never started after 24 h', async () => {
    const owner = await createUser()
    const idle = await createRoom(owner, { ephemeral: true, createdAt: new Date(Date.now() - 25 * 60 * MINUTE) })
    const recent = await createRoom(owner, { ephemeral: true })
    const persistent = await createRoom(owner, { createdAt: new Date(Date.now() - 25 * 60 * MINUTE) })
    const running = await createRoom(owner, { ephemeral: true, createdAt: new Date(Date.now() - 25 * 60 * MINUTE) })
    await createMeeting(running)
    const scope = { roomIds: [idle.id, recent.id, persistent.id, running.id] }
    expect(await archiveIdleEphemeralRooms(new Date(), scope)).toBe(1)
    const deletedAt = async (id: string) => (await testDb().select().from(rooms).where(eq(rooms.id, id)))[0]!.deletedAt
    expect(await deletedAt(idle.id)).not.toBeNull()
    for (const kept of [recent, persistent, running]) expect(await deletedAt(kept.id)).toBeNull()
  })
})
