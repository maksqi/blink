/**
 * `GET /api/recordings/:id/file`: decrypts the stored BLQ1 file on the fly (docs/SECURITY.md §6).
 *
 * - Only `ready` server recordings are served: `recording`/`processing` → 409 `RECORDING_NOT_READY`, `failed` and
 *   local rows → 404. Access as in `access.ts` (404 for everyone else).
 * - One byte range (`range.ts`): 206 with `Content-Range`, 416 with `bytes *\/size`; only the covering segments are
 *   decrypted. The final segment (truncation check) and the first covering segment are verified before any header is
 *   sent, so a damaged file answers 500; a later integrity failure destroys the connection.
 * - Headers: `Content-Type: video/mp4`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox;
 *   default-src 'none'`, `Cache-Control: no-store`, `Accept-Ranges: bytes`, `Content-Disposition` inline (attachment
 *   with `?download=1`) with `filename="blinq-recording.mp4"` and an RFC 5987 `filename*` from room name and date.
 * - Admins who are neither recorder nor room owner are audited (`recording.admin_playback` / `admin_download`), at
 *   most once per admin, recording and kind per 10 minutes, because players repeat Range requests (decision).
 * The response streams with backpressure and is never buffered.
 */
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { getQuery, getRequestHeader, setResponseHeader, setResponseStatus, type H3Event } from 'h3'
import { apiError } from '../../utils/api-error'
import { logger } from '../../utils/logger'
import { audit } from '../audit/audit'
import { loadAccessible, isAdminOnlyAccess, type Viewer } from './access'
import { Blq1Error, openBlq1File, recordingInfo, type Blq1Reader } from './blq1'
import { contentRange, parseRange, unsatisfiedRange } from './range'
import { masterKey, pathForStorageKey } from './storage'

export const ADMIN_AUDIT_DEBOUNCE_MS = 10 * 60_000
const FALLBACK_FILE_NAME = 'blinq-recording.mp4'
const FORBIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cs}]/gu
const RESERVED_CHARACTERS = /[\\/:*?"<>|]+/g

/** `blinq-<room name>-<YYYY-MM-DD>.mp4` with invisible, bidi and path characters removed. */
export function recordingFileName(roomName: string, startedAt: Date): string {
  const cleaned = roomName
    .normalize('NFC')
    .replace(FORBIDDEN_CHARACTERS, '')
    .replace(RESERVED_CHARACTERS, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  const name = Array.from(cleaned).slice(0, 80).join('').trim() || 'recording'
  return `blinq-${name}-${startedAt.toISOString().slice(0, 10)}.mp4`
}

/** RFC 5987 `ext-value` encoding (UTF-8, percent-encoded outside attr-char). */
export function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function contentDisposition(kind: 'inline' | 'attachment', fileName: string): string {
  return `${kind}; filename="${FALLBACK_FILE_NAME}"; filename*=UTF-8''${encodeRfc5987(fileName)}`
}

/** "Once per admin, recording and kind per window" memory for admin access audits. */
export function createAccessDebouncer(windowMs = ADMIN_AUDIT_DEBOUNCE_MS, maxEntries = 10_000) {
  const seen = new Map<string, number>()
  return {
    /** True when this access should be audited now (and remembers it). */
    shouldRecord(key: string, now: number): boolean {
      const last = seen.get(key)
      if (last !== undefined && now - last < windowMs) return false
      seen.delete(key)
      seen.set(key, now)
      if (seen.size > maxEntries) {
        for (const [entry, at] of seen) {
          if (now - at >= windowMs || seen.size > maxEntries) seen.delete(entry)
          else break
        }
      }
      return true
    },
    forget(key: string) {
      seen.delete(key)
    },
  }
}

const adminAccess = createAccessDebouncer()

function setFileHeaders(event: H3Event, disposition: string) {
  setResponseHeader(event, 'Content-Type', 'video/mp4')
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'Content-Security-Policy', "sandbox; default-src 'none'")
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Accept-Ranges', 'bytes')
  setResponseHeader(event, 'Content-Disposition', disposition)
}

function integrityFailure(recordingId: string, error: unknown): never {
  logger.error('recording file failed its integrity check', {
    recordingId,
    reason: error instanceof Blq1Error ? error.reason : 'read_error',
  })
  throw apiError('INTERNAL', 500)
}

export async function serveRecordingFile(event: H3Event, viewer: Viewer, id: string | undefined, now: () => Date = () => new Date()) {
  const row = await loadAccessible(viewer, id)
  if (row.mode === 'local' || row.status === 'failed') throw apiError('NOT_FOUND', 404)
  if (row.status !== 'ready') throw apiError('RECORDING_NOT_READY', 409)
  if (!row.storageKey) throw apiError('NOT_FOUND', 404)
  const download = getQuery(event).download === '1'

  let reader: Blq1Reader
  try {
    reader = await openBlq1File(pathForStorageKey(row.storageKey), { masterKey: masterKey(), info: recordingInfo(row.id) })
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') {
      logger.error('ready recording has no file', { recordingId: row.id })
      throw apiError('NOT_FOUND', 404)
    }
    integrityFailure(row.id, error)
  }

  let streaming = false
  try {
    const size = reader.plaintextSize
    try {
      await reader.verifyFinal()
    } catch (error) {
      integrityFailure(row.id, error)
    }
    // If-Range needs validators this route never sends; a conditional range is served in full (decision).
    const range = getRequestHeader(event, 'if-range') ? { kind: 'full' as const } : parseRange(getRequestHeader(event, 'range'), size)
    if (range.kind === 'unsatisfiable') {
      setResponseHeader(event, 'Content-Range', unsatisfiedRange(size))
      throw apiError('VALIDATION_FAILED', 416, { reason: 'range_not_satisfiable' })
    }
    const start = range.kind === 'partial' ? range.start : 0
    const end = range.kind === 'partial' ? range.end : size - 1
    const parts = size > 0 ? reader.range(start, end) : null
    let first: IteratorResult<Buffer> | null = null
    if (parts) {
      try {
        first = await parts.next()
      } catch (error) {
        integrityFailure(row.id, error)
      }
    }

    if (isAdminOnlyAccess(viewer, row)) {
      const kind = download ? 'download' : 'playback'
      if (adminAccess.shouldRecord(`${viewer.id}|${row.id}|${kind}`, now().getTime())) {
        await audit(event, {
          action: download ? 'recording.admin_download' : 'recording.admin_playback',
          targetType: 'recording',
          targetId: row.id,
          details: { roomId: row.roomId, createdBy: row.createdById },
        })
      }
    }

    setFileHeaders(event, contentDisposition(download ? 'attachment' : 'inline', recordingFileName(row.roomName, row.startedAt)))
    setResponseHeader(event, 'Content-Length', size > 0 ? end - start + 1 : 0)
    if (range.kind === 'partial') {
      setResponseStatus(event, 206)
      setResponseHeader(event, 'Content-Range', contentRange(start, end, size))
    } else {
      setResponseStatus(event, 200)
    }

    const body = Readable.from(
      (async function* () {
        if (first && !first.done) yield first.value
        if (parts) yield* parts
      })(),
    )
    streaming = true
    const res = event.node.res
    try {
      await pipeline(body, res)
    } catch (error) {
      // Headers are gone: all that is left is cutting the connection so the client never takes a damaged file.
      if (error instanceof Blq1Error) logger.error('recording file failed its integrity check mid-stream', { recordingId: row.id, reason: error.reason })
      res.destroy()
    } finally {
      await reader.close()
    }
  } finally {
    if (!streaming) await reader.close()
  }
}
