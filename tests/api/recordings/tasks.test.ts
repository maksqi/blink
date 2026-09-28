/**
 * recordings:finalize-stale and recordings:retention against the API test database, in-process with an injected
 * Clock: stale and abandoned uploads are finalized as partial, `processing` rows are re-enqueued after a restart, an
 * interrupted job is retried once and then fails, and retention deletes expired rows, old failed/local rows and
 * orphaned files while keeping everything else.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PublishRoomState } from '../../../server/contracts'
import { meetings, recordings } from '../../../server/database/schema'
import { deleteRecordingsForUser } from '../../../server/services/recordings/access'
import { cancelRecordingTimers, handleRecordingChanged } from '../../../server/services/recordings/lifecycle'
import { processRecording } from '../../../server/services/recordings/processor'
import { applyRetention, finalizeStale } from '../../../server/services/recordings/tasks'
import { invalidateSettingsCache } from '../../../server/services/settings/settings'
import { createMeeting, createParticipant, createRoom, createUser, serverEnv, testDb, useServerEnvInProcess } from '../_harness'
import { recordingRow, recordingsDir, seedReadyRecording } from './_support'

useServerEnvInProcess()

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

beforeEach(() => invalidateSettingsCache())

interface Scenario {
  mode?: 'server' | 'local'
  status?: 'recording' | 'processing' | 'ready' | 'failed'
  chunkCount?: number
  startedAgoMs?: number
  lastChunkAgoMs?: number | null
  recorder?: 'joined' | 'left' | 'removed'
  meetingEnded?: boolean
  error?: string | null
}

async function scenario(now: Date, options: Scenario = {}) {
  const recorder = await createUser()
  const room = await createRoom(recorder)
  const meeting = await createMeeting(room)
  await createParticipant({ room, meeting, userId: recorder.id, role: 'host', status: options.recorder ?? 'joined' })
  if (options.meetingEnded) await testDb().update(meetings).set({ endedAt: now }).where(eq(meetings.id, meeting.id))
  const [row] = await testDb()
    .insert(recordings)
    .values({
      roomId: room.id,
      meetingId: meeting.id,
      createdBy: recorder.id,
      mode: options.mode ?? 'server',
      status: options.status ?? 'recording',
      sourceMime: options.mode === 'local' ? null : 'video/webm',
      chunkCount: options.chunkCount ?? 3,
      uploadedBytes: (options.chunkCount ?? 3) * 1000,
      startedAt: new Date(now.getTime() - (options.startedAgoMs ?? 10 * MINUTE)),
      lastChunkAt:
        options.lastChunkAgoMs === null ? null : new Date(now.getTime() - (options.lastChunkAgoMs ?? 5 * 1000)),
      error: options.error ?? null,
    })
    .returning()
  return { id: row!.id, roomId: room.id, recorder, room }
}

function fakes() {
  const published: string[] = []
  const enqueued: string[] = []
  const publishRoomState: PublishRoomState = async (roomId) => {
    published.push(roomId)
    return null
  }
  return { published, enqueued, publishRoomState, enqueue: (id: string) => (enqueued.push(id), true) }
}

describe('finalizeStale', () => {
  it('finalizes uploads that went quiet or were abandoned and keeps live ones', async () => {
    const now = new Date(Date.now() + 1_000)
    const quiet = await scenario(now, { lastChunkAgoMs: 2 * MINUTE + 1 })
    const neverSent = await scenario(now, { chunkCount: 0, lastChunkAgoMs: null, startedAgoMs: 3 * MINUTE })
    const left = await scenario(now, { recorder: 'left', lastChunkAgoMs: 31_000 })
    const removed = await scenario(now, { recorder: 'removed', lastChunkAgoMs: 45_000 })
    const ended = await scenario(now, { meetingEnded: true, lastChunkAgoMs: 40_000 })
    const live = await scenario(now, { lastChunkAgoMs: 10_000 })
    const flushing = await scenario(now, { recorder: 'left', lastChunkAgoMs: 10_000 })
    const localGone = await scenario(now, { mode: 'local', chunkCount: 0, lastChunkAgoMs: null, recorder: 'left' })
    const localLive = await scenario(now, { mode: 'local', chunkCount: 0, lastChunkAgoMs: null })
    const deps = fakes()

    const result = await finalizeStale({ clock: { now: () => now }, ...deps })
    expect(result.finalized).toBeGreaterThanOrEqual(6)

    for (const partial of [quiet, left, removed, ended]) {
      const row = await recordingRow(partial.id)
      expect(row, partial.id).toMatchObject({ status: 'processing', partial: true, error: null })
      expect(row!.endedAt?.getTime()).toBe(now.getTime())
      expect(deps.enqueued).toContain(partial.id)
      expect(deps.published).toContain(partial.roomId)
    }
    expect(await recordingRow(neverSent.id)).toMatchObject({ status: 'failed', partial: true, error: 'no_chunks' })
    expect(deps.enqueued).not.toContain(neverSent.id)
    expect(await recordingRow(localGone.id)).toMatchObject({ status: 'ready', partial: false })
    for (const kept of [live, flushing, localLive]) {
      expect(await recordingRow(kept.id), kept.id).toMatchObject({ status: 'recording', endedAt: null })
      expect(deps.published).not.toContain(kept.roomId)
    }
  })

  it('does not publish again for a recording that was already stopped', async () => {
    const now = new Date(Date.now() + 1_000)
    const stopped = await scenario(now, { lastChunkAgoMs: 3 * MINUTE })
    await testDb().update(recordings).set({ endedAt: new Date(now.getTime() - 3 * MINUTE) }).where(eq(recordings.id, stopped.id))
    const deps = fakes()
    await finalizeStale({ clock: { now: () => now }, ...deps })
    expect(await recordingRow(stopped.id)).toMatchObject({ status: 'processing', partial: true })
    expect(deps.published).not.toContain(stopped.roomId)
  })

  it('re-enqueues processing rows after a simulated restart (empty queue)', async () => {
    const now = new Date()
    const waiting = await scenario(now, { status: 'processing' })
    const deps = fakes()
    const result = await finalizeStale({ clock: { now: () => now }, ...deps })
    expect(deps.enqueued).toContain(waiting.id)
    expect(result.requeued).toBeGreaterThanOrEqual(1)
  })
})

describe('recording.changed (bus)', () => {
  const lifecycle = (now: Date, deps: ReturnType<typeof fakes>) => ({
    clock: { now: () => now },
    publishRoomState: deps.publishRoomState,
    enqueue: (id: string) => void deps.enqueue(id),
  })
  const changed = (s: { id: string; roomId: string }) => ({ type: 'recording.changed' as const, roomId: s.roomId, recordingId: s.id })

  it('finalizes the recording of an ended meeting once the uploader had its grace period', async () => {
    const now = new Date()
    const s = await scenario(now, { meetingEnded: true, lastChunkAgoMs: 40_000 })
    const deps = fakes()
    await handleRecordingChanged(changed(s), lifecycle(now, deps))
    expect(await recordingRow(s.id)).toMatchObject({ status: 'processing', partial: true })
    expect(deps.published).toContain(s.roomId)
    expect(deps.enqueued).toEqual([s.id])
  })

  it('turns the indicator off at once but lets a flushing uploader complete', async () => {
    const now = new Date()
    const s = await scenario(now, { recorder: 'left', lastChunkAgoMs: 5_000 })
    const deps = fakes()
    try {
      await handleRecordingChanged(changed(s), lifecycle(now, deps))
      const row = await recordingRow(s.id)
      expect(row).toMatchObject({ status: 'recording', partial: false })
      expect(row!.endedAt?.getTime()).toBe(now.getTime())
      expect(deps.published).toEqual([s.roomId])
      expect(deps.enqueued).toEqual([])
    } finally {
      cancelRecordingTimers()
    }
  })

  it('ignores the hint while the recorder is still in a live meeting, and ends local recordings of ended meetings', async () => {
    const now = new Date()
    const live = await scenario(now)
    const local = await scenario(now, { mode: 'local', chunkCount: 0, lastChunkAgoMs: null, meetingEnded: true })
    const deps = fakes()
    await handleRecordingChanged(changed(live), lifecycle(now, deps))
    await handleRecordingChanged({ ...changed(live), roomId: local.roomId }, lifecycle(now, deps))
    expect(await recordingRow(live.id)).toMatchObject({ status: 'recording', endedAt: null })
    await handleRecordingChanged(changed(local), lifecycle(now, deps))
    expect(await recordingRow(local.id)).toMatchObject({ status: 'ready' })
    expect(deps.published).toEqual([local.roomId])
  })
})

describe('deleteRecordingsForUser', () => {
  it('deletes files and rows of everything the user recorded or owns, and nothing else', async () => {
    const user = await createUser()
    const other = await createUser()
    const ownRoom = await createRoom(user)
    const otherRoom = await createRoom(other)
    const recorded = await seedReadyRecording({ createdBy: user.id, roomId: otherRoom.id })
    const inOwnRoom = await seedReadyRecording({ createdBy: other.id, roomId: ownRoom.id })
    const unrelated = await seedReadyRecording({ createdBy: other.id, roomId: otherRoom.id })
    expect(await deleteRecordingsForUser(user.id, async () => null)).toBe(2)
    for (const gone of [recorded, inOwnRoom]) {
      expect(await recordingRow(gone.id)).toBeUndefined()
      expect(existsSync(gone.path)).toBe(false)
    }
    expect(await recordingRow(unrelated.id)).toBeDefined()
    expect(existsSync(unrelated.path)).toBe(true)
  })
})

describe('interrupted jobs', () => {
  it('retries a job interrupted once and fails it as interrupted after the second interruption', async () => {
    const now = new Date()
    // First interruption: the marker says attempt 1 started; this run is attempt 2 (it fails on the missing chunks).
    const once = await scenario(now, { status: 'processing', error: 'attempt:1' })
    await processRecording(once.id, new AbortController().signal)
    expect(await recordingRow(once.id)).toMatchObject({ status: 'failed', error: 'missing_chunks' })

    const twice = await scenario(now, { status: 'processing', error: 'attempt:2' })
    await processRecording(twice.id, new AbortController().signal)
    expect(await recordingRow(twice.id)).toMatchObject({ status: 'failed', error: 'interrupted' })
  })
})

describe('applyRetention', () => {
  function oldDir(path: string, ageMs: number) {
    const at = new Date(Date.now() - ageMs)
    utimesSync(path, at, at)
  }

  it('deletes expired, old failed and old local recordings with their files, and keeps the rest', async () => {
    const now = new Date()
    const owner = await createUser()
    const room = await createRoom(owner)
    const expired = await seedReadyRecording({ createdBy: owner.id, roomId: room.id, expiresAt: new Date(now.getTime() - MINUTE) })
    const current = await seedReadyRecording({ createdBy: owner.id, roomId: room.id, expiresAt: new Date(now.getTime() + DAY) })
    const oldFailed = await scenario(now, { status: 'failed', startedAgoMs: 31 * DAY, lastChunkAgoMs: null })
    const newFailed = await scenario(now, { status: 'failed', startedAgoMs: 2 * DAY, lastChunkAgoMs: null })
    const oldLocal = await scenario(now, { mode: 'local', status: 'ready', chunkCount: 0, startedAgoMs: 31 * DAY, lastChunkAgoMs: null })
    const newLocal = await scenario(now, { mode: 'local', status: 'ready', chunkCount: 0, startedAgoMs: DAY, lastChunkAgoMs: null })

    const result = await applyRetention({ clock: { now: () => now } })
    expect(result.expired).toBeGreaterThanOrEqual(1)
    expect(result.failed).toBeGreaterThanOrEqual(1)
    expect(result.local).toBeGreaterThanOrEqual(1)

    for (const gone of [expired.id, oldFailed.id, oldLocal.id]) expect(await recordingRow(gone), gone).toBeUndefined()
    expect(existsSync(join(recordingsDir(), expired.id))).toBe(false)
    for (const kept of [current.id, newFailed.id, newLocal.id]) expect(await recordingRow(kept), kept).toBeDefined()
    expect(existsSync(current.path)).toBe(true)
  })

  it('purges orphaned directories, leftover chunks and stale work dirs older than a day', async () => {
    const now = new Date()
    const owner = await createUser()
    const room = await createRoom(owner)
    const root = recordingsDir()

    const orphanOld = join(root, randomUUID())
    mkdirSync(orphanOld, { recursive: true })
    writeFileSync(join(orphanOld, 'chunk-000000.blq1'), 'BLQ1')
    oldDir(orphanOld, 2 * DAY)
    const orphanNew = join(root, randomUUID())
    mkdirSync(orphanNew, { recursive: true })
    const junk = join(root, `junk-${randomUUID()}`)
    mkdirSync(junk)
    oldDir(junk, 2 * DAY)

    const ready = await seedReadyRecording({ createdBy: owner.id, roomId: room.id })
    const leftover = join(root, ready.id, 'chunk-000000.blq1')
    writeFileSync(leftover, 'BLQ1')
    oldDir(leftover, 2 * DAY)

    const work = join(serverEnv().RECORDING_WORK_DIR!, randomUUID())
    mkdirSync(work, { recursive: true })
    oldDir(work, 2 * DAY)

    const result = await applyRetention({ clock: { now: () => now } })
    expect(result.orphans).toBeGreaterThanOrEqual(4)
    expect(existsSync(orphanOld)).toBe(false)
    expect(existsSync(junk)).toBe(false)
    expect(existsSync(orphanNew)).toBe(true)
    expect(existsSync(leftover)).toBe(false)
    expect(existsSync(ready.path)).toBe(true)
    expect(existsSync(work)).toBe(false)
  })
})
