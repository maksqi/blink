/**
 * LiveKit webhook authentication and deduplication (docs/API.md §10): the raw body must carry a valid signature;
 * replayed event ids are processed once; rooms missing from this database are acknowledged and ignored.
 */
import { randomUUID } from 'node:crypto'
import { WebhookEvent } from 'livekit-server-sdk'
import { describe, expect, it } from 'vitest'
import { createClient, createRoom, createUser, expectApiError, signWebhook } from '../_harness'
import { livekitCalls, participantRow, sendWebhook, startMeeting, usesFakeLivekit } from '../rooms/_support'

const post = (raw: string, authorization?: string) =>
  createClient().post('/api/webhooks/livekit', {
    raw,
    origin: null,
    headers: { 'content-type': 'application/webhook+json', ...(authorization ? { authorization } : {}) },
  })

describe('webhook signature', () => {
  it('rejects a missing, malformed or foreign signature and a modified body with 401', async () => {
    const webhook = new WebhookEvent({ id: `EV_${randomUUID()}`, room: { name: randomUUID() } })
    webhook.event = 'room_started'
    const body = webhook.toJsonString()
    expect(body).toContain('"event":"room_started"')
    expectApiError(await post(body), 401, 'UNAUTHENTICATED')
    expectApiError(await post(body, 'not-a-jwt'), 401, 'UNAUTHENTICATED')
    expectApiError(await post(body, await signWebhook(body, 'devkey', 'another-secret-another-secret-another-0000')), 401, 'UNAUTHENTICATED')
    expectApiError(await post(body, await signWebhook(body, 'otherkey')), 401, 'UNAUTHENTICATED')
    expectApiError(await post(body.replace('room_started', 'room_finished'), await signWebhook(body)), 401, 'UNAUTHENTICATED')
    expect((await post(body, await signWebhook(body))).body).toEqual({ ok: true })
  })

  it('needs no Origin (CSRF exempt) but still the signature', async () => {
    const res = await sendWebhook('room_started', { id: randomUUID() }, undefined, { tamper: true })
    expectApiError(res, 401, 'UNAUTHENTICATED')
  })

  it('acknowledges events for rooms of other deployments without touching anything', async () => {
    const res = await sendWebhook('participant_joined', { id: randomUUID() }, { identity: 'p_OtherAgent000000' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    const alsoForeign = await sendWebhook('room_finished', { id: 'not-a-uuid' })
    expect(alsoForeign.status).toBe(200)
  })
})

describe.skipIf(!usesFakeLivekit())('webhook deduplication', () => {
  it('processes a replayed event id once', async () => {
    const owner = await createUser()
    const room = await createRoom(owner)
    await startMeeting(room, owner)
    const id = `EV_${randomUUID()}`
    const identity = 'p_Intruder00000000'
    expect((await sendWebhook('participant_joined', room, { identity }, { id })).status).toBe(200)
    expect((await sendWebhook('participant_joined', room, { identity }, { id })).status).toBe(200)
    expect((await livekitCalls(room.id, 'removeParticipant')).filter((c) => c.args[1] === identity)).toHaveLength(1)
    expect((await sendWebhook('participant_joined', room, { identity })).status).toBe(200)
    expect((await livekitCalls(room.id, 'removeParticipant')).filter((c) => c.args[1] === identity)).toHaveLength(2)
  })

  it('does not replay a join into a later state', async () => {
    const owner = await createUser()
    const room = await createRoom(owner)
    const host = await startMeeting(room, owner)
    const id = `EV_${randomUUID()}`
    const joinedAtMs = Date.now()
    await sendWebhook('participant_joined', room, { identity: host.identity, joinedAtMs }, { id })
    await sendWebhook('participant_left', room, { identity: host.identity, joinedAtMs })
    await sendWebhook('participant_joined', room, { identity: host.identity, joinedAtMs }, { id })
    expect((await participantRow(host.identity))!.status).toBe('left')
  })
})
