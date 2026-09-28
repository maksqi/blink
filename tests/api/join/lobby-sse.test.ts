/**
 * Waiting-room SSE and cancel (docs/API.md §6.1, docs/SECURITY.md §4): only the session or guest session that owns the
 * request may read or cancel it; the current state comes first, decisions follow in order and are final.
 */
import { TokenVerifier } from 'livekit-server-sdk'
import { describe, expect, it } from 'vitest'
import { createClient, createRoom, createUser, expectApiError, loginAs, serverEnv } from '../_harness'
import { joinGuest, joinUser, requestRow, startMeeting } from '../rooms/_support'
import { openSse } from './_sse'

async function setup(options: { waitingRoom?: boolean } = {}) {
  const owner = await createUser()
  const room = await createRoom(owner, { waitingRoom: options.waitingRoom ?? true })
  const host = await startMeeting(room, owner)
  return { owner, room, host }
}

describe('ownership', () => {
  it('lets only the owning guest session read and cancel a request', async () => {
    const { room } = await setup()
    const guest = await joinGuest(room, { expectStatus: 202 })
    const requestId = guest.res.body.requestId as string
    const other = await joinGuest(room, { expectStatus: 202 })

    for (const api of [createClient(), other.api, await loginAs(await createUser())]) {
      const opened = await openSse(api, requestId)
      expect(opened.status).toBe(403)
      expect(opened.body).toMatchObject({ statusCode: 403, data: { code: 'FORBIDDEN' } })
      expectApiError(await api.post(`/api/join/requests/${requestId}/cancel`), 403, 'FORBIDDEN')
    }
    expect((await requestRow(requestId))!.status).toBe('waiting')

    const own = await openSse(guest.api, requestId)
    expect(own.status).toBe(200)
    expect(own.stream!.contentType).toContain('text/event-stream')
    expect(await own.stream!.nextEvent()).toMatchObject({ event: 'status', data: { status: 'waiting' } })
    own.stream!.close()
  })

  it('lets only the owning user read a user request (any of their sessions)', async () => {
    const { room } = await setup()
    const waiting = await joinUser(room, { expectStatus: 202 })
    const requestId = waiting.res.body.requestId as string
    const sameUser = await loginAs(waiting.user!)
    const opened = await openSse(sameUser, requestId)
    expect(opened.status).toBe(200)
    opened.stream!.close()
    expect((await openSse(await loginAs(await createUser()), requestId)).status).toBe(403)
    expect((await openSse(createClient(), requestId)).status).toBe(403)
  })

  it('answers 404 for unknown and malformed request ids', async () => {
    const api = createClient()
    expect((await openSse(api, '0192d2f4-7a3b-7cde-8f01-23456789abcd')).status).toBe(404)
    expect((await openSse(api, 'nope')).status).toBe(404)
    expectApiError(await api.post('/api/join/requests/0192d2f4-7a3b-7cde-8f01-23456789abcd/cancel'), 404, 'NOT_FOUND')
  })
})

describe('events', () => {
  it('sends status first, then admitted with a token for the owner row only, then closes', async () => {
    const { room, host } = await setup()
    const guest = await joinGuest(room, { expectStatus: 202 })
    const requestId = guest.res.body.requestId as string
    const { stream } = await openSse(guest.api, requestId)
    expect(await stream!.nextEvent()).toMatchObject({ event: 'status', data: { status: 'waiting' } })
    expect((await host.api.post(`/api/calls/${room.id}/lobby/${requestId}/admit`)).status).toBe(204)
    const admitted = await stream!.nextEvent()
    expect(admitted).toMatchObject({ kind: 'event', event: 'admitted' })
    const data = (admitted as { data: Record<string, string> }).data
    const row = await requestRow(requestId)
    expect(data).toEqual({
      token: expect.any(String),
      url: serverEnv().LIVEKIT_PUBLIC_URL,
      epoch: host.res.body.epoch,
      identity: row!.lkIdentity,
      role: 'participant',
      roomId: room.id,
    })
    const claims = await new TokenVerifier(serverEnv().LIVEKIT_API_KEY!, serverEnv().LIVEKIT_API_SECRET!).verify(data.token!)
    expect(claims.sub).toBe(row!.lkIdentity)
    expect(claims.video?.room).toBe(room.id)
    expect(await stream!.nextEvent()).toMatchObject({ kind: 'closed' })
    // Reconnecting after the decision gets the final state again (with a fresh token), still only for the owner.
    const again = await openSse(guest.api, requestId)
    expect(await again.stream!.nextEvent()).toMatchObject({ event: 'admitted', data: { identity: row!.lkIdentity } })
  })

  it('sends denied { reason: denied } and closes', async () => {
    const { room, host } = await setup()
    const guest = await joinGuest(room, { expectStatus: 202 })
    const { stream } = await openSse(guest.api, guest.res.body.requestId)
    await stream!.nextEvent()
    await host.api.post(`/api/calls/${room.id}/lobby/${guest.res.body.requestId}/deny`)
    expect(await stream!.nextEvent()).toMatchObject({ event: 'denied', data: { reason: 'denied' } })
    expect(await stream!.nextEvent()).toMatchObject({ kind: 'closed' })
  })

  it('sends denied { reason: locked } when the room gets locked', async () => {
    const { room, host } = await setup()
    const guest = await joinGuest(room, { expectStatus: 202 })
    const { stream } = await openSse(guest.api, guest.res.body.requestId)
    await stream!.nextEvent()
    expect((await host.api.patch(`/api/calls/${room.id}/settings`, { body: { locked: true } })).status).toBe(200)
    expect(await stream!.nextEvent()).toMatchObject({ event: 'denied', data: { reason: 'locked' } })
  })

  it('sends ended when the meeting ends or the owner cancels', async () => {
    const { room, host } = await setup()
    const first = await joinGuest(room, { expectStatus: 202 })
    const second = await joinGuest(room, { expectStatus: 202 })
    const a = (await openSse(first.api, first.res.body.requestId)).stream!
    const b = (await openSse(second.api, second.res.body.requestId)).stream!
    await a.nextEvent()
    await b.nextEvent()
    expect((await second.api.post(`/api/join/requests/${second.res.body.requestId}/cancel`)).status).toBe(204)
    expect(await b.nextEvent()).toMatchObject({ event: 'ended', data: {} })
    expect((await requestRow(second.res.body.requestId))!.status).toBe('left')
    expect((await host.api.post(`/api/calls/${room.id}/end`)).status).toBe(204)
    expect(await a.nextEvent()).toMatchObject({ event: 'ended' })
  })

  it('sends a ping comment every 15 s', { timeout: 25_000 }, async () => {
    const { room } = await setup()
    const guest = await joinGuest(room, { expectStatus: 202 })
    const { stream } = await openSse(guest.api, guest.res.body.requestId)
    expect(await stream!.next()).toMatchObject({ kind: 'event', event: 'status' })
    const started = Date.now()
    expect(await stream!.next(17_000)).toMatchObject({ kind: 'comment', text: 'ping' })
    expect(Date.now() - started).toBeGreaterThan(10_000)
    stream!.close()
  })
})
