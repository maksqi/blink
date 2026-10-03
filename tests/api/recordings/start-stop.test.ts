/**
 * POST /api/calls/:roomId/recording/start and /stop: permissions (host and co-host with an account only), one active
 * recording per room, settings, quota, and the REC indicator through publishRoomState.
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { roomMetadataSchema } from '#shared/schemas/livekit'
import type { PublishRoomState } from '../../../server/contracts'
import { auditLog, recordings, users } from '../../../server/database/schema'
import { startRecording, stopRecording } from '../../../server/services/recordings/lifecycle'
import { invalidateSettingsCache } from '../../../server/services/settings/settings'
import { createClient, createUser, expectApiError, fakeEvent, loginAs, testDb, useServerEnvInProcess } from '../_harness'
import { livekitCalls, usesFakeLivekit } from '../rooms/_support'
import { joinAs, liveCall, recordingRow, seedReadyRecording, setRecordingSettings } from './_support'

useServerEnvInProcess()

const GIB = 1024 ** 3
const serverBody = { mode: 'server', mimeType: 'video/webm;codecs=vp9,opus', width: 1280, height: 720 }

const start = (client: ReturnType<typeof createClient>, roomId: string, body: unknown = serverBody) =>
  client.post(`/api/calls/${roomId}/recording/start`, { body })
const stop = (client: ReturnType<typeof createClient>, roomId: string) => client.post(`/api/calls/${roomId}/recording/stop`)

async function auditRows(action: string, targetId: string) {
  return testDb()
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)))
}

describe('recording start and stop', () => {
  afterEach(async () => {
    await setRecordingSettings({})
  })

  it('lets the host start (201), keeps one active recording per room and lets a co-host stop it (204)', async () => {
    const call = await liveCall()
    const cohost = await joinAs(call, { role: 'cohost' })

    const res = await start(call.client, call.room.id)
    expect(res.status, res.text).toBe(201)
    expect(res.body).toEqual({
      recordingId: expect.any(String),
      maxDurationMs: 240 * 60_000,
      chunkMaxBytes: 16 * 1024 * 1024,
    })
    const id = res.body.recordingId as string
    expect(await recordingRow(id)).toMatchObject({
      roomId: call.room.id,
      meetingId: call.meeting.id,
      createdBy: call.owner.id,
      mode: 'server',
      status: 'recording',
      sourceMime: serverBody.mimeType,
      width: 1280,
      height: 720,
      endedAt: null,
    })
    const [started] = await auditRows('recording.started', id)
    expect(started).toMatchObject({ actorUserId: call.owner.id, actorParticipantId: call.host.id, targetType: 'recording' })

    expectApiError(await start(cohost.client, call.room.id), 409, 'RECORDING_ACTIVE')
    expectApiError(await start(call.client, call.room.id, { mode: 'local' }), 409, 'RECORDING_ACTIVE')

    const stopped = await stop(cohost.client, call.room.id)
    expect(stopped.status, stopped.text).toBe(204)
    const row = await recordingRow(id)
    // Stopped: the indicator is off, but the recorder may still upload its last chunks and complete.
    expect(row).toMatchObject({ status: 'recording' })
    expect(row!.endedAt).toBeInstanceOf(Date)
    expect(await auditRows('recording.stopped', id)).toHaveLength(1)

    const again = await stop(cohost.client, call.room.id)
    expectApiError(again, 409, 'CONFLICT')
    expect(again.body.data.details).toEqual({ reason: 'not_recording' })

    // A co-host with an account may record too, once nothing is active.
    const second = await start(cohost.client, call.room.id)
    expect(second.status, second.text).toBe(201)
    expect(await recordingRow(second.body.recordingId)).toMatchObject({ createdBy: cohost.user!.id })
  })

  it('refuses guest co-hosts and participants (403 RECORDING_NOT_ALLOWED), for start and stop', async () => {
    const call = await liveCall()
    const guestCohost = await joinAs(call, { role: 'cohost', kind: 'guest' })
    const participant = await joinAs(call, { role: 'participant' })
    const guest = await joinAs(call, { role: 'participant', kind: 'guest' })
    for (const who of [guestCohost, participant, guest]) {
      expectApiError(await start(who.client, call.room.id), 403, 'RECORDING_NOT_ALLOWED')
      expectApiError(await start(who.client, call.room.id, { mode: 'local' }), 403, 'RECORDING_NOT_ALLOWED')
    }
    expect(await start(call.client, call.room.id)).toMatchObject({ status: 201 })
    for (const who of [guestCohost, participant, guest]) {
      expectApiError(await stop(who.client, call.room.id), 403, 'RECORDING_NOT_ALLOWED')
    }
    const active = await testDb()
      .select()
      .from(recordings)
      .where(and(eq(recordings.roomId, call.room.id), isNull(recordings.endedAt)))
    expect(active).toHaveLength(1)
  })

  it('refuses people outside the meeting (403 CALL_NOT_PARTICIPANT) and anonymous callers', async () => {
    const call = await liveCall()
    const outsider = await loginAs(await createUser())
    expectApiError(await start(outsider, call.room.id), 403, 'CALL_NOT_PARTICIPANT')
    expectApiError(await stop(outsider, call.room.id), 403, 'CALL_NOT_PARTICIPANT')
    expectApiError(await start(createClient(), call.room.id), 403, 'CALL_NOT_PARTICIPANT')
    expectApiError(await start(call.client, 'not-a-room'), 403, 'CALL_NOT_PARTICIPANT')
  })

  it('refuses both modes while recording is disabled (403 RECORDING_DISABLED)', async () => {
    const call = await liveCall()
    await setRecordingSettings({ enabled: false })
    expectApiError(await start(call.client, call.room.id), 403, 'RECORDING_DISABLED')
    expectApiError(await start(call.client, call.room.id, { mode: 'local' }), 403, 'RECORDING_DISABLED')
    await setRecordingSettings({})
    expect(await start(call.client, call.room.id, { mode: 'local' })).toMatchObject({ status: 201 })
  })

  it('validates the body, dimensions above recording.maxResolution and the MIME type of server recordings', async () => {
    const call = await liveCall()
    for (const body of [
      { mode: 'cloud' },
      { mode: 'server', mimeType: 'video/x-matroska' },
      { mode: 'server', mimeType: 'video/webm', width: 3840, height: 2160 },
      { mode: 'server' },
    ]) {
      expectApiError(await start(call.client, call.room.id, body), 400, 'VALIDATION_FAILED')
    }
    await setRecordingSettings({ maxResolution: '720p' })
    const tooWide = await start(call.client, call.room.id, { ...serverBody, width: 1920, height: 1080 })
    expectApiError(tooWide, 400, 'VALIDATION_FAILED')
    expect(tooWide.body.data.details.issues[0].path).toBe('width')
    expect(await start(call.client, call.room.id, serverBody)).toMatchObject({ status: 201 })
  })

  it('refuses server recordings once the quota is used up (409 RECORDING_QUOTA_EXCEEDED); local mode needs no quota', async () => {
    const call = await liveCall()
    const seeded = await seedReadyRecording({ createdBy: call.owner.id, roomId: call.room.id })
    await testDb().update(recordings).set({ sizeBytes: 20 * GIB }).where(eq(recordings.id, seeded.id))
    expectApiError(await start(call.client, call.room.id), 409, 'RECORDING_QUOTA_EXCEEDED')
    expect(await start(call.client, call.room.id, { mode: 'local' })).toMatchObject({ status: 201 })
  })

  it('local mode: the row drives the indicator only and becomes ready without a file on stop', async () => {
    const call = await liveCall()
    const res = await start(call.client, call.room.id, { mode: 'local' })
    expect(res.status, res.text).toBe(201)
    const id = res.body.recordingId as string
    expect(await recordingRow(id)).toMatchObject({ mode: 'local', status: 'recording', sourceMime: null })
    expect(await stop(call.client, call.room.id)).toMatchObject({ status: 204 })
    expect(await recordingRow(id)).toMatchObject({ mode: 'local', status: 'ready', storageKey: null })
  })
})

describe('REC indicator (publishRoomState)', () => {
  /** A fake that derives `recording` from the active row the way publishRoomState does (docs/API.md §12). */
  function recordingPublisher() {
    const calls: Array<{ roomId: string; recording: { mode: string; by: string; startedAt: string } | null }> = []
    const publish: PublishRoomState = async (roomId) => {
      const [active] = await testDb()
        .select({ mode: recordings.mode, by: users.displayName, startedAt: recordings.startedAt })
        .from(recordings)
        .innerJoin(users, eq(users.id, recordings.createdBy))
        .where(and(eq(recordings.roomId, roomId), eq(recordings.status, 'recording'), isNull(recordings.endedAt)))
        .orderBy(desc(recordings.startedAt))
        .limit(1)
      calls.push({ roomId, recording: active ? { ...active, startedAt: active.startedAt.toISOString() } : null })
      return null
    }
    return { calls, publish }
  }

  const deps = (publish: PublishRoomState) => ({ clock: { now: () => new Date() }, publishRoomState: publish, enqueue: () => {} })

  // Settings are cached per process; earlier tests changed them through the database.
  beforeEach(() => invalidateSettingsCache())

  it('publishes the room state with `recording` set after start and cleared after stop', async () => {
    const call = await liveCall()
    const { calls, publish } = recordingPublisher()
    const event = fakeEvent({ cookie: call.client.cookieHeader() })
    const started = await startRecording(event, call.host, { mode: 'server', mimeType: 'video/webm' }, deps(publish))
    expect(calls).toEqual([{ roomId: call.room.id, recording: { mode: 'server', by: call.owner.displayName, startedAt: expect.any(String) } }])
    await stopRecording(event, call.host, deps(publish))
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual({ roomId: call.room.id, recording: null })
    expect((await recordingRow(started.recordingId))!.endedAt).toBeInstanceOf(Date)
  })

  it('answers 503 and keeps no row when the indicator cannot be published', async () => {
    const call = await liveCall()
    const failing: PublishRoomState = async () => {
      throw new Error('livekit down')
    }
    const event = fakeEvent({ cookie: call.client.cookieHeader() })
    await expect(startRecording(event, call.host, { mode: 'local' }, deps(failing))).rejects.toMatchObject({
      statusCode: 503,
      data: { code: 'SERVICE_UNAVAILABLE' },
    })
    expect(await testDb().select().from(recordings).where(eq(recordings.roomId, call.room.id))).toHaveLength(0)
  })

  it.skipIf(!usesFakeLivekit())('sends the metadata through the fake RoomService', async () => {
    const call = await liveCall()
    expect(await start(call.client, call.room.id)).toMatchObject({ status: 201 })
    expect(await stop(call.client, call.room.id)).toMatchObject({ status: 204 })
    const updates = (await livekitCalls(call.room.id, 'updateRoomMetadata')).map((c) => {
      expect(c.args[0]).toBe(call.room.id)
      const metadata = roomMetadataSchema.parse(JSON.parse(String(c.args[1])))
      expect(metadata.epoch).toBe(call.meeting.epoch)
      return metadata.recording
    })
    expect(updates.at(-2)).toEqual({ mode: 'server', by: call.owner.displayName, startedAt: expect.any(String) })
    expect(updates.at(-1)).toBeNull()
  })
})
