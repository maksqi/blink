/**
 * Lobby latency (Stage 04 DoD): a host's admit reaches the waiting owner's SSE in under 1 s (API level).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { createRoom, createUser } from '../_harness'
import { joinGuest, setSetting, startMeeting } from '../rooms/_support'
import { openSse } from './_sse'

describe('lobby latency', () => {
  // The waiting person is a guest. The server caches settings for up to 5 s, so an earlier file that turned
  // guests.allowed off can still be in effect: restore the default and wait until the server sees it.
  beforeAll(() => setSetting('guests.allowed', null))

  it('delivers admitted to the SSE in under 1 s', async () => {
    const owner = await createUser()
    const room = await createRoom(owner, { waitingRoom: true })
    const host = await startMeeting(room, owner)
    const guest = await joinGuest(room, { expectStatus: 202 })
    const { stream } = await openSse(guest.api, guest.res.body.requestId)
    expect(await stream!.nextEvent()).toMatchObject({ event: 'status' })

    const started = Date.now()
    const admit = host.api.post(`/api/calls/${room.id}/lobby/${guest.res.body.requestId}/admit`)
    const admitted = await stream!.nextEvent(1_000)
    const elapsed = admitted.at - started
    expect((await admit).status).toBe(204)
    expect(admitted).toMatchObject({ kind: 'event', event: 'admitted' })
    console.info(`[lobby-latency] admit → admitted in ${elapsed} ms`)
    expect(elapsed).toBeLessThan(1_000)
  })
})
