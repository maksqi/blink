/**
 * Scheduled recording maintenance (nuxt.config.ts `scheduledTasks`).
 *
 * `finalizeStale({ clock, publishRoomState, enqueue })` — `recordings:finalize-stale`, every 2 minutes:
 *   rows still `recording` whose uploader is gone (no chunk for 2 min, or recorder left / meeting ended plus a 30 s
 *   grace; `state.ts#shouldFinalize`) are finalized: server rows → `partial` + `processing` (`failed` without chunks),
 *   local rows → `ready`; the indicator is turned off where it was on. Every `processing` row missing from the queue
 *   (restart) is enqueued again.
 * `applyRetention({ clock })` — `recordings:retention`, daily: deletes rows and files past `expiresAt`, `failed` and
 *   local rows older than `recording.retentionDays`, and orphaned files: directories without a row, and leftover
 *   chunk/temp files of finished rows, older than 1 day. Stale work directories go too.
 */
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { and, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm'
import { systemClock, type Clock, type PublishRoomState } from '../../contracts'
import { useDb } from '../../database/client'
import { callParticipants, meetings, recordings } from '../../database/schema'
import { logger } from '../../utils/logger'
import { publishRoomState } from '../livekit/room-state'
import { getSettings } from '../settings/settings'
import { enqueueRecording, recordingQueue, resumeProcessing } from './jobs'
import { finalizeRecording } from './lifecycle'
import { shouldFinalize } from './state'
import { FINAL_FILE, isRecordingId, recordingsRoot, removeRecordingFiles, workRoot } from './storage'

const DAY_MS = 24 * 3_600_000
export const ORPHAN_MIN_AGE_MS = DAY_MS

export interface FinalizeStaleDeps {
  clock?: Clock
  publishRoomState?: PublishRoomState
  enqueue?: (id: string) => boolean
}

export interface FinalizeStaleResult {
  finalized: number
  requeued: number
}

export async function finalizeStale(deps: FinalizeStaleDeps = {}): Promise<FinalizeStaleResult> {
  const clock = deps.clock ?? systemClock
  const enqueue = deps.enqueue ?? enqueueRecording
  const lifecycle = { clock, publishRoomState: deps.publishRoomState ?? publishRoomState, enqueue: (id: string) => void enqueue(id) }
  const now = clock.now()
  const settings = await getSettings()
  const db = useDb()
  const recorderPresent = sql<boolean>`exists (select 1 from ${callParticipants} where ${callParticipants.meetingId} = ${recordings.meetingId} and ${callParticipants.userId} = ${recordings.createdBy} and ${callParticipants.status} in ('admitted', 'joined'))`
  const rows = await db
    .select({
      id: recordings.id,
      mode: recordings.mode,
      chunkCount: recordings.chunkCount,
      startedAt: recordings.startedAt,
      lastChunkAt: recordings.lastChunkAt,
      meetingEndedAt: meetings.endedAt,
      meetingId: meetings.id,
      recorderPresent,
    })
    .from(recordings)
    .leftJoin(meetings, eq(meetings.id, recordings.meetingId))
    .where(eq(recordings.status, 'recording'))

  let finalized = 0
  for (const row of rows) {
    const facts = {
      mode: row.mode,
      chunkCount: row.chunkCount,
      startedAt: row.startedAt,
      lastChunkAt: row.lastChunkAt,
      meetingEnded: row.meetingId === null || row.meetingEndedAt !== null,
      recorderPresent: Boolean(row.recorderPresent),
    }
    if (!shouldFinalize(facts, now, settings['recording.maxDurationMinutes'])) continue
    const outcome = await finalizeRecording(row.id, 'stale', lifecycle, db)
    if (outcome.changed) finalized++
  }
  const requeued = await resumeProcessing(enqueue)
  return { finalized, requeued }
}

export interface RetentionDeps {
  clock?: Clock
}

export interface RetentionResult {
  expired: number
  failed: number
  local: number
  orphans: number
}

/** Pure: the cutoffs of one retention run. */
export function recordingRetentionCutoffs(now: Date, retentionDays: number) {
  return {
    now,
    olderThan: new Date(now.getTime() - retentionDays * DAY_MS),
    orphanBefore: new Date(now.getTime() - ORPHAN_MIN_AGE_MS),
  }
}

async function entries(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

async function olderThan(path: string, cutoff: Date): Promise<boolean> {
  try {
    return (await stat(path)).mtime.getTime() < cutoff.getTime()
  } catch {
    return false
  }
}

async function purgeOrphans(cutoff: Date): Promise<number> {
  const root = recordingsRoot()
  const names = await entries(root)
  const ids = names.filter(isRecordingId)
  const known = new Map<string, string>()
  if (ids.length) {
    const rows = await useDb()
      .select({ id: recordings.id, status: recordings.status })
      .from(recordings)
      .where(inArray(recordings.id, ids))
    for (const row of rows) known.set(row.id, row.status)
  }
  let removed = 0
  for (const name of names) {
    const path = join(root, name)
    const status = isRecordingId(name) ? known.get(name) : undefined
    if (status === undefined) {
      // No row (or not a recording directory at all): nothing can ever read it.
      if (await olderThan(path, cutoff)) {
        await rm(path, { recursive: true, force: true })
        removed++
      }
      continue
    }
    if (status !== 'ready' && status !== 'failed') continue
    // Finished rows keep only the final file; chunks and temp files left behind by a crash go.
    for (const file of await entries(path)) {
      if (status === 'ready' && file === FINAL_FILE) continue
      const filePath = join(path, file)
      if (await olderThan(filePath, cutoff)) {
        await rm(filePath, { recursive: true, force: true })
        removed++
      }
    }
  }
  const running = recordingQueue().running
  for (const name of await entries(workRoot())) {
    if (name === running) continue
    const path = join(workRoot(), name)
    if (await olderThan(path, cutoff)) {
      await rm(path, { recursive: true, force: true })
      removed++
    }
  }
  return removed
}

export async function applyRetention(deps: RetentionDeps = {}): Promise<RetentionResult> {
  const now = (deps.clock ?? systemClock).now()
  const settings = await getSettings()
  const cutoffs = recordingRetentionCutoffs(now, settings['recording.retentionDays'])
  const db = useDb()
  const doomed = await db
    .select({ id: recordings.id, status: recordings.status, mode: recordings.mode })
    .from(recordings)
    .where(
      or(
        and(eq(recordings.status, 'ready'), isNotNull(recordings.expiresAt), lt(recordings.expiresAt, now)),
        and(
          or(eq(recordings.status, 'failed'), and(eq(recordings.mode, 'local'), eq(recordings.status, 'ready'))),
          lt(sql`coalesce(${recordings.endedAt}, ${recordings.startedAt})`, cutoffs.olderThan.toISOString()),
        ),
      ),
    )
  const result: RetentionResult = { expired: 0, failed: 0, local: 0, orphans: 0 }
  for (const row of doomed) {
    const deleted = await db.delete(recordings).where(eq(recordings.id, row.id)).returning({ id: recordings.id })
    if (!deleted.length) continue
    await removeRecordingFiles(row.id)
    if (row.status === 'failed') result.failed++
    else if (row.mode === 'local') result.local++
    else result.expired++
  }
  result.orphans = await purgeOrphans(cutoffs.orphanBefore)
  if (result.expired + result.failed + result.local + result.orphans > 0) logger.info('recording retention', { ...result })
  return result
}
