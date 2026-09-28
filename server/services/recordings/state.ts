/**
 * Recording state machine rules (pure, unit-tested). Statuses:
 *
 *   recording ──complete──▶ processing ──job──▶ ready
 *       │                        └──job fails──▶ failed
 *       ├──finalize (partial)──▶ processing | failed (no chunks)
 *       └──local: stop or finalize──▶ ready (no file)
 *
 * `ended_at` is the REC indicator: a row is *active* (indicator on, one per room) while `status = 'recording'` and
 * `ended_at IS NULL`. After stop the recorder still uploads its remaining chunks and completes; chunks are accepted
 * while `status = 'recording'`.
 */
export type RecordingStatus = 'recording' | 'processing' | 'ready' | 'failed'
export type RecordingMode = 'server' | 'local'

/** No chunk for this long → the uploader is gone: finalize as partial. */
export const STALE_AFTER_MS = 2 * 60_000
/** When the recorder left or the meeting ended, give a flushing uploader this long before finalizing (decision). */
export const ABANDONED_GRACE_MS = 30_000
/** Chunks later than startedAt + maxDuration + this are refused (413). */
export const LATE_CHUNK_GRACE_MS = 2 * 60_000

/** Short failure codes stored in `recordings.error` (never shown verbatim to users). */
export type FailureCode =
  | 'invalid_media'
  | 'timeout'
  | 'ffmpeg_failed'
  | 'too_large'
  | 'interrupted'
  | 'no_chunks'
  | 'missing_chunks'
  | 'integrity'

export function isActive(row: { status: RecordingStatus; endedAt: Date | null }): boolean {
  return row.status === 'recording' && row.endedAt === null
}

export type ChunkRejection = 'not_recording' | 'gap' | 'too_late'

/** Whether chunk `seq` may be stored now: the next one, or a retry of one already stored. */
export function chunkRejection(
  row: { mode: RecordingMode; status: RecordingStatus; chunkCount: number; startedAt: Date },
  seq: number,
  now: Date,
  maxDurationMinutes: number,
): ChunkRejection | null {
  if (row.mode !== 'server' || row.status !== 'recording') return 'not_recording'
  if (seq > row.chunkCount) return 'gap'
  if (now.getTime() > row.startedAt.getTime() + maxDurationMinutes * 60_000 + LATE_CHUNK_GRACE_MS) return 'too_late'
  return null
}

const ATTEMPT = /^attempt:(\d)$/

/**
 * A job that starts writes an attempt marker into `error`. Finding a marker means an earlier attempt was interrupted
 * (restart or crash): the job is retried once, then the recording fails as `interrupted` (decision).
 */
export function nextAttempt(error: string | null): { attempt: number; marker: string } | 'give_up' {
  const match = error?.match(ATTEMPT)
  const previous = match ? Number(match[1]) : 0
  if (previous >= 2) return 'give_up'
  const attempt = previous + 1
  return { attempt, marker: `attempt:${attempt}` }
}

/** What finalizing a still-`recording` row turns it into. */
export function finalizeTarget(row: { mode: RecordingMode; chunkCount: number }): {
  status: 'ready' | 'processing' | 'failed'
  partial: boolean
  error: FailureCode | null
} {
  if (row.mode === 'local') return { status: 'ready', partial: false, error: null }
  if (row.chunkCount === 0) return { status: 'failed', partial: true, error: 'no_chunks' }
  return { status: 'processing', partial: true, error: null }
}

export interface StaleFacts {
  mode: RecordingMode
  chunkCount: number
  startedAt: Date
  lastChunkAt: Date | null
  /** The meeting the recording belongs to has ended (or is gone). */
  meetingEnded: boolean
  /** The recorder still has an admitted or joined row in that meeting. */
  recorderPresent: boolean
}

/** Pure decision of `recordings:finalize-stale` for one row in status `recording`. */
export function shouldFinalize(facts: StaleFacts, now: Date, maxDurationMinutes: number): boolean {
  const abandoned = facts.meetingEnded || !facts.recorderPresent
  if (facts.mode === 'local') {
    // Nothing is uploaded: the row only drives the indicator. A recorder who is gone cannot still be recording.
    const overdue = now.getTime() > facts.startedAt.getTime() + maxDurationMinutes * 60_000 + LATE_CHUNK_GRACE_MS
    return abandoned || overdue
  }
  const idle = now.getTime() - (facts.lastChunkAt ?? facts.startedAt).getTime()
  if (idle >= STALE_AFTER_MS) return true
  return abandoned && idle >= ABANDONED_GRACE_MS
}
