/**
 * Joining against the dev LiveKit (docs/TESTING.md §5.4): the first admitted join creates the LiveKit room with the
 * metadata publishRoomState would write, the grant's token is accepted by LiveKit for that room, live settings reach the
 * room metadata, and ending the meeting deletes the room. Runs only with `API_LIVEKIT_URL`.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { buildRoomStateFromDb } from '../../../server/services/livekit/publish-room-state'
import { createLivekitRoomService } from '../../../server/services/livekit/room-service'
import { createRoom, createUser, serverEnv, useServerEnvInProcess } from '../_harness'
import { joinGuest, startMeeting, usesFakeLivekit } from '../rooms/_support'

useServerEnvInProcess()

describe.skipIf(usesFakeLivekit())('meetings on a real LiveKit', () => {
  const env = serverEnv()
  const service = createLivekitRoomService({ url: env.LIVEKIT_URL!, apiKey: env.LIVEKIT_API_KEY!, apiSecret: env.LIVEKIT_API_SECRET! })
  const rooms: string[] = []
  afterAll(async () => {
    for (const name of rooms) await service.deleteRoom(name)
  })

  it('creates the room, admits with a valid token, publishes settings and deletes the room at the end', async () => {
    const owner = await createUser()
    const room = await createRoom(owner, { waitingRoom: false })
    rooms.push(room.id)
    const host = await startMeeting(room, owner)
    const [live] = await service.listRooms([room.id])
    expect(live).toBeDefined()
    expect(JSON.parse(live!.metadata)).toEqual(await buildRoomStateFromDb(room.id))

    const guest = await joinGuest(room, { expectStatus: 200 })
    for (const token of [host.res.body.token, guest.res.body.token]) {
      const res = await fetch(new URL(`/rtc/validate?access_token=${token}`, env.LIVEKIT_URL))
      expect(res.status).toBe(200)
    }

    const locked = await host.api.patch(`/api/calls/${room.id}/settings`, { body: { locked: true, chatEnabled: false } })
    expect(locked.status, locked.text).toBe(200)
    expect(JSON.parse((await service.listRooms([room.id]))[0]!.metadata)).toEqual(locked.body.state)

    expect((await host.api.post(`/api/calls/${room.id}/end`)).status).toBe(204)
    expect(await service.listRooms([room.id])).toEqual([])
  })
})
