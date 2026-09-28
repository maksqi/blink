/**
 * Chunk ingest: `PUT /api/recordings/:id/chunks/:seq` (docs/API.md §8, Stage 08).
 *
 * The raw request is streamed (nothing reads the body before this) through a byte counter and BLQ1 encryption into a
 * temp file, which is renamed into place under the row lock. The body is never buffered and never touches disk in
 * plaintext. Over `RECORDING_CHUNK_MAX_BYTES` the rest of the body is drained without being stored (so the client
 * still reads the 413) up to a hard cap, beyond which the connection is dropped.
 *
 * Rules: the recorder only (403); server mode and status `recording` (409 `not_recording`); `seq` is the next chunk
 * or a retry of a stored one (replaced); a gap → 409; quota (409 `RECORDING_QUOTA_EXCEEDED`); free space below
 * 2 GiB → 503; a chunk later than startedAt + maxDuration + 2 min → 413. Updates chunkCount, uploadedBytes, lastChunkAt.
 */
import { createWriteStream } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { Transform, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { getRequestHeader, type H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { RECORDING_CHUNK_MAX_BYTES } from '#shared/schemas/recordings'
import { systemClock, type Clock } from '../../contracts'
import { useDb } from '../../database/client'
import { recordings } from '../../database/schema'
import { apiError } from '../../utils/api-error'
import { consumeOr429 } from '../../utils/limiter'
import { logger } from '../../utils/logger'
import { getSettings } from '../settings/settings'
import { chunkInfo, createEncryptStream } from './blq1'
import { exceedsQuota, quotaUsedUp, userUsageBytes } from './quota'
import { chunkRejection } from './state'
import {
  chunkPath,
  ensureRecordingDir,
  freeBytes,
  isRecordingId,
  masterKey,
  MIN_FREE_BYTES,
  recordingsRoot,
  storedPlaintextSize,
  tempPath,
} from './storage'

/** Past this many bytes an oversized body is no longer drained: the connection is dropped (decision). */
export const DRAIN_HARD_CAP_BYTES = 2 * RECORDING_CHUNK_MAX_BYTES
const MAX_SEQ = 99_999

export interface IngestDeps {
  clock: Clock
  /** Free bytes on RECORDINGS_DIR (injectable for tests). */
  freeBytes: (path: string) => Promise<number>
}

const defaultDeps = (): IngestDeps => ({ clock: systemClock, freeBytes })

class ConnectionDropped extends Error {}

/** Counts bytes; above `max` it stops forwarding (the body is drained), above the hard cap it errors. */
class ChunkCounter extends Transform {
  bytes = 0
  tooLarge: boolean

  constructor(
    private readonly max: number,
    startTooLarge: boolean,
  ) {
    super()
    this.tooLarge = startTooLarge
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
    this.bytes += chunk.length
    if (this.bytes > DRAIN_HARD_CAP_BYTES) return callback(new ConnectionDropped('body too large'))
    if (this.bytes > this.max) this.tooLarge = true
    callback(null, this.tooLarge ? undefined : chunk)
  }
}

export function parseSeq(value: string | undefined): number {
  if (!value || !/^\d{1,5}$/.test(value)) {
    throw apiError('VALIDATION_FAILED', 400, { issues: [{ path: 'seq', message: 'Must be a chunk number from 0' }] })
  }
  const seq = Number(value)
  if (seq > MAX_SEQ) throw apiError('VALIDATION_FAILED', 400, { issues: [{ path: 'seq', message: 'Too many chunks' }] })
  return seq
}

export async function ingestChunk(
  event: H3Event,
  user: { id: string },
  recordingId: string | undefined,
  rawSeq: string | undefined,
  deps: IngestDeps = defaultDeps(),
): Promise<void> {
  // No existence oracle: unknown ids and other people's recordings look the same.
  if (!isRecordingId(recordingId)) throw apiError('FORBIDDEN', 403)
  const seq = parseSeq(rawSeq)
  const db = useDb()
  const [row] = await db.select().from(recordings).where(eq(recordings.id, recordingId)).limit(1)
  if (!row || row.createdBy !== user.id) throw apiError('FORBIDDEN', 403)
  consumeOr429(event, 'recording-chunks', `recording:${row.id}`)

  const contentType = (getRequestHeader(event, 'content-type') ?? '').split(';', 1)[0]!.trim().toLowerCase()
  if (contentType !== 'application/octet-stream') {
    throw apiError('VALIDATION_FAILED', 400, { issues: [{ path: 'content-type', message: 'Use application/octet-stream' }] })
  }
  const settings = await getSettings()
  const now = deps.clock.now()
  const rejection = chunkRejection(row, seq, now, settings['recording.maxDurationMinutes'])
  if (rejection === 'not_recording') throw apiError('CONFLICT', 409, { reason: 'not_recording' })
  if (rejection === 'gap') throw apiError('CONFLICT', 409, { reason: 'chunk_gap', expected: row.chunkCount })
  if (rejection === 'too_late') throw apiError('RECORDING_TOO_LARGE', 413)
  const quotaGb = settings['recording.userQuotaGb']
  if (quotaUsedUp(await userUsageBytes(user.id), quotaGb)) throw apiError('RECORDING_QUOTA_EXCEEDED', 409)
  if ((await deps.freeBytes(recordingsRoot())) < MIN_FREE_BYTES) {
    logger.error('recording upload refused: less than 2 GiB free on RECORDINGS_DIR')
    throw apiError('SERVICE_UNAVAILABLE', 503)
  }

  const declared = Number(getRequestHeader(event, 'content-length') ?? Number.NaN)
  const counter = new ChunkCounter(RECORDING_CHUNK_MAX_BYTES, Number.isFinite(declared) && declared > RECORDING_CHUNK_MAX_BYTES)
  await ensureRecordingDir(row.id)
  const temp = tempPath(row.id)
  try {
    try {
      await pipeline(
        event.node.req,
        counter,
        createEncryptStream({ masterKey: masterKey(), info: chunkInfo(row.id, seq) }),
        createWriteStream(temp, { flush: true, mode: 0o600 }),
      )
    } catch (error) {
      if (error instanceof ConnectionDropped) logger.warn('recording chunk upload dropped: body far above the limit', { recordingId: row.id })
      // The client went away or sent far too much: there is nobody left to answer.
      throw apiError('VALIDATION_FAILED', 400, { issues: [{ path: 'body', message: 'Upload interrupted' }] })
    }
    if (counter.tooLarge) throw apiError('RECORDING_TOO_LARGE', 413)
    if (counter.bytes === 0) throw apiError('VALIDATION_FAILED', 400, { issues: [{ path: 'body', message: 'Empty chunk' }] })
    await commitChunk(row.id, user.id, seq, counter.bytes, temp, quotaGb, deps.clock.now())
  } finally {
    await rm(temp, { force: true })
  }
}

async function commitChunk(id: string, userId: string, seq: number, bytes: number, temp: string, quotaGb: number, now: Date) {
  await useDb().transaction(async (tx) => {
    const [row] = await tx.select().from(recordings).where(eq(recordings.id, id)).limit(1).for('update')
    if (!row) throw apiError('FORBIDDEN', 403)
    if (row.mode !== 'server' || row.status !== 'recording') throw apiError('CONFLICT', 409, { reason: 'not_recording' })
    if (seq > row.chunkCount) throw apiError('CONFLICT', 409, { reason: 'chunk_gap', expected: row.chunkCount })
    const target = chunkPath(id, seq)
    const retry = seq < row.chunkCount
    const previous = retry ? ((await storedPlaintextSize(target)) ?? 0) : 0
    if (exceedsQuota(await userUsageBytes(userId, tx), bytes - previous, quotaGb)) throw apiError('RECORDING_QUOTA_EXCEEDED', 409)
    // Rename before the row update: a failed commit leaves a file that the next upload of this seq replaces.
    await rename(temp, target)
    await tx
      .update(recordings)
      .set({
        chunkCount: retry ? row.chunkCount : row.chunkCount + 1,
        uploadedBytes: Math.max(0, row.uploadedBytes - previous + bytes),
        lastChunkAt: now,
      })
      .where(eq(recordings.id, id))
  })
}
