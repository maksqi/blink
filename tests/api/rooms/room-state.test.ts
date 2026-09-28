/**
 * Room metadata (docs/API.md §12): written only by publishRoomState (and the initial createRoom, from the same
 * builder), always equal to what the database says.
 */
import { describe, expect, it } from 'vitest'
import { roomMetadataSchema } from '#shared/schemas/livekit'
import { recordings } from '../../../server/database/schema'
import { buildRoomStateFromDb } from '../../../server/services/livekit/publish-room-state'
import { createRoom, createUser, loginAs, testDb, useServerEnvInProcess } from '../_harness'
import { joinUser, livekitCalls, participantRow, startMeeting, usesFakeLivekit } from './_support'

useServerEnvInProcess()

async function lastMetadata(roomId: string) {
  const calls = await livekitCalls(roomId, 'updateRoomMetadata')
  return JSON.parse(calls.at(-1)!.args[1] as string)
}

describe.skipIf(!usesFakeLivekit())('room metadata', () => {
  it('starts the LiveKit room with metadata built from the database', async () => {
    const owner = await createUser()
    const room = await createRoom(owner, { waitingRoom: false, screenSharePolicy: 'hosts', chatEnabled: false })
    const host = await startMeeting(room, owner)
    const [create] = await livekitCalls(room.id, 'createRoom')
    expect(create!.args[0]).toMatchObject({ name: room.id, maxParticipants: 25, emptyTimeoutSec: 300, departureTimeoutSec: 20 })
    const metadata = roomMetadataSchema.parse(JSON.parse(create!.args[0].metadata))
    expect(metadata).toEqual(await buildRoomStateFromDb(room.id))
    expect(metadata).toMatchObject({ v: 1, epoch: host.res.body.epoch, locked: false, waitingRoom: false, screenSharePolicy: 'hosts', chatEnabled: false, recording: null })
  })

  it('follows every live settings change and returns the published state', async () => {
    const owner = await createUser()
    const room = await createRoom(owner)
    const host = await startMeeting(room, owner)
    for (const patch of [{ locked: true }, { chatEnabled: false }, { allowSelfUnmute: false, screenSharePolicy: 'hosts' }, { locked: false }]) {
      const res = await host.api.patch(`/api/calls/${room.id}/settings`, { body: patch })
      expect(res.status, res.text).toBe(200)
      const expected = await buildRoomStateFromDb(room.id)
      expect(res.body.state).toEqual(expected)
      expect(await lastMetadata(room.id)).toEqual(expected)
    }
    expect(await lastMetadata(room.id)).toMatchObject({ locked: false, chatEnabled: false, allowSelfUnmute: false, screenSharePolicy: 'hosts' })
  })

  it('publishes owner changes made through PATCH /api/rooms/:id during a live meeting', async () => {
    const owner = await createUser()
    const room = await createRoom(owner)
    await startMeeting(room, owner)
    const res = await (await loginAs(owner)).patch(`/api/rooms/${room.id}`, { body: { waitingRoom: false } })
    expect(res.status).toBe(200)
    expect(await lastMetadata(room.id)).toEqual(await buildRoomStateFromDb(room.id))
    expect((await lastMetadata(room.id)).waitingRoom).toBe(false)
  })

  it('shows an active recording with the recorder name in the call', async () => {
    const owner = await createUser()
    const room = await createRoom(owner, { waitingRoom: false })
    const host = await startMeeting(room, owner)
    await joinUser(room, { expectStatus: 200 })
    const hostRow = await participantRow(host.identity)
    await testDb().insert(recordings).values({
      roomId: room.id,
      meetingId: hostRow!.meetingId,
      createdBy: owner.id,
      mode: 'local',
      startedAt: new Date('2026-09-28T12:00:00.000Z'),
    })
    const res = await host.api.patch(`/api/calls/${room.id}/settings`, { body: {} })
    expect(res.status).toBe(200)
    expect(res.body.state.recording).toEqual({ mode: 'local', by: owner.displayName, startedAt: '2026-09-28T12:00:00.000Z' })
    expect(await lastMetadata(room.id)).toEqual(await buildRoomStateFromDb(room.id))
  })
})
