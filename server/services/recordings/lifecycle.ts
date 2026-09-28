/**
 * Recording lifecycle: start, stop, complete and finalize (Stage 08, docs/API.md §7 and §8).
 *
 * - `startRecording(event, caller, input)`: host or co-host with an account (`canPerform`), `recording.enabled`,
 *   dimensions within `recording.maxResolution`, quota; one active row per room under `pg_advisory_xact_lock`; then
 *   `publishRoomState` (REC indicator for everyone) — if that fails the row is deleted and the call answers 503, so
 *   nothing is ever recorded without the indicator.
 * - `stopRecording(event, caller)`: any moderator with an account; sets `ended_at` (indicator off). Server rows keep
 *   accepting the remaining chunks until the recorder completes; local rows become `ready` (no file).
 * - `completeRecording(event, user, id, input)`: the recorder; all chunks present → `processing` → queued.
 * - `finalizeRecording(id, reason)`: idempotent immediate finalize of a still-`recording` row (partial).
 * - `handleRecordingChanged(event)`: bus handler for `recording.changed` (meeting ended, recorder left): turns the
 *   indicator off at once and finalizes once the uploader had `ABANDONED_GRACE_MS` to flush (decision).
 * Every function takes `deps` (clock, publishRoomState, enqueue) so tests can inject fakes.
 */
import type { H3Event } from 'h3'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { RECORDING_CHUNK_MAX_BYTES, type StartRecordingResponse, type startRecordingSchema } from '#shared/schemas/recordings'
import { canPerform, type CallActor } from '#shared/utils/permissions'
import type { z } from 'zod'
import { systemClock, type BusEvent, type Clock, type PublishRoomState } from '../../contracts'
import { useDb, type Db, type Tx } from '../../database/client'
import { callParticipants, meetings, recordings } from '../../database/schema'
import { apiError } from '../../utils/api-error'
import { logger } from '../../utils/logger'
import { audit } from '../audit/audit'
import { publishRoomState } from '../livekit/room-state'
import type { CallParticipant } from '../session/callers'
import { getSettings } from '../settings/settings'
import { RESOLUTION_BOX } from './ffmpeg-args'
import { enqueueRecording } from './jobs'
import { demuxerForMime } from './probe'
import { quotaUsedUp, userUsageBytes } from './quota'
import { ABANDONED_GRACE_MS, finalizeTarget, isActive } from './state'
import { chunkPath, fileExists, removeChunkFiles } from './storage'

export type StartRecordingInput = z.output<typeof startRecordingSchema>

export interface LifecycleDeps {
  clock: Clock
  publishRoomState: PublishRoomState
  enqueue: (id: string) => void
}

export function defaultLifecycleDeps(): LifecycleDeps {
  return {
    clock: systemClock,
    publishRoomState,
    enqueue: (id) => {
      enqueueRecording(id)
    },
  }
}

type RecordingRow = typeof recordings.$inferSelect

const ROOM_LOCK_PREFIX = 'blinq:recording-room:'

async function lockRoom(tx: Tx, roomId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ROOM_LOCK_PREFIX + roomId}))`)
}

export function callActor(caller: CallParticipant): CallActor {
  return { identity: caller.lkIdentity, role: caller.roomRole, kind: caller.userId ? 'user' : 'guest' }
}

/** Guests and plain participants never record or stop recordings: 403 `RECORDING_NOT_ALLOWED`. */
export function assertMayRecord(caller: CallParticipant, action: 'recording.start' | 'recording.stop'): void {
  if (!caller.userId || !canPerform(callActor(caller), action)) throw apiError('RECORDING_NOT_ALLOWED', 403)
}

function validationError(path: string, message: string) {
  return apiError('VALIDATION_FAILED', 400, { issues: [{ path, message }] })
}

/** Publishes room state, logging instead of failing (used where the database change must stand). */
async function publishQuietly(deps: LifecycleDeps, roomId: string, context: Record<string, unknown>) {
  try {
    await deps.publishRoomState(roomId)
  } catch (error) {
    logger.warn('publishing room state after a recording change failed', { roomId, ...context, err: error })
  }
}

export async function startRecording(
  event: H3Event | null,
  caller: CallParticipant,
  input: StartRecordingInput,
  deps: LifecycleDeps = defaultLifecycleDeps(),
): Promise<StartRecordingResponse> {
  assertMayRecord(caller, 'recording.start')
  const settings = await getSettings()
  if (!settings['recording.enabled']) throw apiError('RECORDING_DISABLED', 403)
  const box = RESOLUTION_BOX[settings['recording.maxResolution']]
  if (input.width !== undefined && input.width > box.width) {
    throw validationError('width', `The maximum recording width is ${box.width} pixels`)
  }
  if (input.height !== undefined && input.height > box.height) {
    throw validationError('height', `The maximum recording height is ${box.height} pixels`)
  }
  if (input.mode === 'server' && !demuxerForMime(input.mimeType)) {
    throw validationError('mimeType', 'Server recordings need the MediaRecorder MIME type')
  }
  const userId = caller.userId!
  if (input.mode === 'server' && quotaUsedUp(await userUsageBytes(userId), settings['recording.userQuotaGb'])) {
    throw apiError('RECORDING_QUOTA_EXCEEDED', 409)
  }

  const db = useDb()
  const now = deps.clock.now()
  const row = await db.transaction(async (tx) => {
    await lockRoom(tx, caller.roomId)
    const [active] = await tx
      .select({ id: recordings.id })
      .from(recordings)
      .where(and(eq(recordings.roomId, caller.roomId), eq(recordings.status, 'recording'), isNull(recordings.endedAt)))
      .limit(1)
    if (active) throw apiError('RECORDING_ACTIVE', 409)
    const [inserted] = await tx
      .insert(recordings)
      .values({
        roomId: caller.roomId,
        meetingId: caller.meetingId,
        createdBy: userId,
        mode: input.mode,
        status: 'recording',
        sourceMime: input.mode === 'server' ? (input.mimeType ?? null) : null,
        width: input.width ?? null,
        height: input.height ?? null,
        startedAt: now,
      })
      .returning()
    return inserted!
  })

  try {
    await deps.publishRoomState(caller.roomId)
  } catch (error) {
    // No recording without an indicator: undo and let the recorder try again.
    await db.delete(recordings).where(eq(recordings.id, row.id))
    logger.error('publishing the REC indicator failed; the recording was not started', { roomId: caller.roomId, err: error })
    throw apiError('SERVICE_UNAVAILABLE', 503)
  }

  await audit(event, {
    action: 'recording.started',
    actorUserId: userId,
    actorParticipantId: caller.id,
    targetType: 'recording',
    targetId: row.id,
    details: { roomId: caller.roomId, mode: input.mode },
  })
  return {
    recordingId: row.id,
    maxDurationMs: settings['recording.maxDurationMinutes'] * 60_000,
    chunkMaxBytes: RECORDING_CHUNK_MAX_BYTES,
  }
}

export async function stopRecording(
  event: H3Event | null,
  caller: CallParticipant,
  deps: LifecycleDeps = defaultLifecycleDeps(),
): Promise<void> {
  assertMayRecord(caller, 'recording.stop')
  const now = deps.clock.now()
  const stopped = await useDb().transaction(async (tx) => {
    await lockRoom(tx, caller.roomId)
    const [active] = await tx
      .select()
      .from(recordings)
      .where(and(eq(recordings.roomId, caller.roomId), eq(recordings.status, 'recording'), isNull(recordings.endedAt)))
      .limit(1)
      .for('update')
    if (!active) throw apiError('CONFLICT', 409, { reason: 'not_recording' })
    await tx
      .update(recordings)
      .set(active.mode === 'local' ? { endedAt: now, status: 'ready' } : { endedAt: now })
      .where(eq(recordings.id, active.id))
    return active
  })
  await publishQuietly(deps, caller.roomId, { recordingId: stopped.id })
  await audit(event, {
    action: 'recording.stopped',
    actorUserId: caller.userId,
    actorParticipantId: caller.id,
    targetType: 'recording',
    targetId: stopped.id,
    details: { roomId: caller.roomId, mode: stopped.mode },
  })
}

export async function completeRecording(
  user: { id: string },
  recordingId: string,
  input: { chunkCount: number; durationMs: number },
  deps: LifecycleDeps = defaultLifecycleDeps(),
): Promise<{ status: 'processing' }> {
  const now = deps.clock.now()
  const result = await useDb().transaction(async (tx) => {
    const [row] = await tx.select().from(recordings).where(eq(recordings.id, recordingId)).limit(1).for('update')
    if (!row || row.createdBy !== user.id) throw apiError('FORBIDDEN', 403)
    if (row.mode !== 'server') throw apiError('CONFLICT', 409, { reason: 'not_recording' })
    if (row.status === 'processing' && row.chunkCount === input.chunkCount) return { row, wasActive: false, repeat: true }
    if (row.status !== 'recording') throw apiError('CONFLICT', 409, { reason: 'not_recording' })
    if (row.chunkCount !== input.chunkCount) {
      throw apiError('CONFLICT', 409, { reason: 'chunk_count_mismatch', stored: row.chunkCount })
    }
    for (let seq = 0; seq < row.chunkCount; seq++) {
      if (!(await fileExists(chunkPath(row.id, seq)))) {
        throw apiError('CONFLICT', 409, { reason: 'chunk_count_mismatch', stored: seq })
      }
    }
    await tx
      .update(recordings)
      .set({ status: 'processing', endedAt: row.endedAt ?? now, durationMs: input.durationMs, error: null })
      .where(eq(recordings.id, row.id))
    return { row, wasActive: isActive(row), repeat: false }
  })
  if (result.wasActive) await publishQuietly(deps, result.row.roomId, { recordingId })
  deps.enqueue(recordingId)
  return { status: 'processing' }
}

export type FinalizeReason = 'stale' | 'recorder-left' | 'meeting-ended' | 'admin'

export interface FinalizeOutcome {
  changed: boolean
  status: RecordingRow['status'] | null
}

/**
 * Finalizes a row that is still `recording` (idempotent): server rows become `processing` (partial) or `failed`
 * without chunks, local rows `ready`. Turns the indicator off when it was on.
 */
export async function finalizeRecording(
  recordingId: string,
  reason: FinalizeReason,
  deps: LifecycleDeps = defaultLifecycleDeps(),
  db: Db = useDb(),
): Promise<FinalizeOutcome> {
  const now = deps.clock.now()
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(recordings).where(eq(recordings.id, recordingId)).limit(1).for('update')
    if (!row) return null
    if (row.status !== 'recording') return { row, target: null }
    const target = finalizeTarget(row)
    await tx
      .update(recordings)
      .set({ status: target.status, partial: target.partial, error: target.error, endedAt: row.endedAt ?? now })
      .where(eq(recordings.id, row.id))
    return { row, target }
  })
  if (!result) return { changed: false, status: null }
  if (!result.target) return { changed: false, status: result.row.status }
  const { row, target } = result
  if (isActive(row)) await publishQuietly(deps, row.roomId, { recordingId })
  if (target.status === 'processing') deps.enqueue(row.id)
  if (target.status === 'failed') await removeChunkFiles(row.id)
  logger.info('recording finalized', { recordingId, reason, status: target.status, partial: target.partial })
  return { changed: true, status: target.status }
}

/** Whether the recording's meeting has ended and whether its recorder is still admitted or joined there. */
export async function abandonmentFacts(
  row: Pick<RecordingRow, 'meetingId' | 'createdBy'>,
  db: Db | Tx = useDb(),
): Promise<{ meetingEnded: boolean; recorderPresent: boolean }> {
  if (!row.meetingId) return { meetingEnded: true, recorderPresent: false }
  const [meeting] = await db.select({ endedAt: meetings.endedAt }).from(meetings).where(eq(meetings.id, row.meetingId)).limit(1)
  const [present] = await db
    .select({ id: callParticipants.id })
    .from(callParticipants)
    .where(
      and(
        eq(callParticipants.meetingId, row.meetingId),
        eq(callParticipants.userId, row.createdBy),
        inArray(callParticipants.status, ['admitted', 'joined']),
      ),
    )
    .limit(1)
  return { meetingEnded: !meeting || meeting.endedAt !== null, recorderPresent: Boolean(present) }
}

const recheckTimers = new Map<string, NodeJS.Timeout>()

/**
 * `recording.changed` from rooms-backend (meeting ended, recorder left). The event itself is only a hint: the row is
 * re-read and acted on only when its meeting really ended or its recorder is really gone.
 */
export async function handleRecordingChanged(
  event: Extract<BusEvent, { type: 'recording.changed' }>,
  deps: LifecycleDeps = defaultLifecycleDeps(),
): Promise<void> {
  const db = useDb()
  const [row] = await db.select().from(recordings).where(eq(recordings.id, event.recordingId)).limit(1)
  if (!row || row.roomId !== event.roomId || row.status !== 'recording') return
  const facts = await abandonmentFacts(row, db)
  if (!facts.meetingEnded && facts.recorderPresent) return
  const reason: FinalizeReason = facts.meetingEnded ? 'meeting-ended' : 'recorder-left'
  if (row.mode === 'local') {
    await finalizeRecording(row.id, reason, deps, db)
    return
  }
  const now = deps.clock.now()
  if (row.endedAt === null) {
    // The indicator goes off now; the uploader may still flush its last chunks and complete normally.
    await db
      .update(recordings)
      .set({ endedAt: now })
      .where(and(eq(recordings.id, row.id), eq(recordings.status, 'recording'), isNull(recordings.endedAt)))
    await publishQuietly(deps, row.roomId, { recordingId: row.id })
  }
  const idle = now.getTime() - (row.lastChunkAt ?? row.startedAt).getTime()
  if (idle >= ABANDONED_GRACE_MS) {
    await finalizeRecording(row.id, reason, deps, db)
    return
  }
  if (recheckTimers.has(row.id)) return
  const timer = setTimeout(() => {
    recheckTimers.delete(row.id)
    handleRecordingChanged(event, deps).catch((error: unknown) =>
      logger.error('recording finalize re-check failed', { recordingId: row.id, err: error }),
    )
  }, ABANDONED_GRACE_MS - idle + 1_000)
  timer.unref()
  recheckTimers.set(row.id, timer)
}

export function cancelRecordingTimers(): void {
  for (const timer of recheckTimers.values()) clearTimeout(timer)
  recheckTimers.clear()
}
