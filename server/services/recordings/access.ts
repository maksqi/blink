/**
 * Recording lists, details and deletion (docs/API.md §8 and §9).
 *
 * Access: the recorder, the room owner or an admin. Anyone else gets 404 `NOT_FOUND` (no existence oracle).
 * - `listRecordings(user, query)`: own recordings and recordings of rooms the user owns, newest first (`q`: room name).
 * - `listAllRecordings(query)`: admin list (`q`: room name, creator name or email).
 * - `getRecordingForUser(user, id)`, `deleteRecording(event, user, id)` (409 while `recording`/`processing`).
 * - `adminDeleteRecording(event, admin, id)`: any state; cancels the job and turns an active indicator off.
 * - `deleteRecordingsForUser(userId)`: files and rows of everything the user recorded or owns (Stage 03 calls it
 *   before deleting the user row).
 */
import type { H3Event } from 'h3'
import { and, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
import type { Paginated } from '#shared/schemas/common'
import type { RecordingSummary } from '#shared/schemas/recordings'
import { useDb } from '../../database/client'
import { recordings, rooms, users } from '../../database/schema'
import { apiError } from '../../utils/api-error'
import { logger } from '../../utils/logger'
import { audit } from '../audit/audit'
import { publishRoomState } from '../livekit/room-state'
import type { PublishRoomState } from '../../contracts'
import { recordingQueue } from './jobs'
import { isActive } from './state'
import { isRecordingId, removeRecordingFiles } from './storage'

export interface PageQuery {
  page: number
  pageSize: number
  q?: string
}

export interface Viewer {
  id: string
  role: 'admin' | 'user'
}

const summaryColumns = {
  id: recordings.id,
  roomId: recordings.roomId,
  roomName: rooms.name,
  roomOwnerId: rooms.ownerId,
  mode: recordings.mode,
  status: recordings.status,
  partial: recordings.partial,
  title: recordings.title,
  durationMs: recordings.durationMs,
  sizeBytes: recordings.sizeBytes,
  width: recordings.width,
  height: recordings.height,
  createdById: recordings.createdBy,
  creatorName: users.displayName,
  startedAt: recordings.startedAt,
  endedAt: recordings.endedAt,
  expiresAt: recordings.expiresAt,
  storageKey: recordings.storageKey,
}

export type AccessibleRecording = {
  id: string
  roomId: string
  roomName: string
  roomOwnerId: string
  mode: 'server' | 'local'
  status: 'recording' | 'processing' | 'ready' | 'failed'
  partial: boolean
  title: string | null
  durationMs: number | null
  sizeBytes: number | null
  width: number | null
  height: number | null
  createdById: string
  creatorName: string
  startedAt: Date
  endedAt: Date | null
  expiresAt: Date | null
  storageKey: string | null
}

export function toSummary(row: AccessibleRecording): RecordingSummary {
  return {
    id: row.id,
    roomId: row.roomId,
    roomName: row.roomName,
    mode: row.mode,
    status: row.status,
    partial: row.partial,
    title: row.title,
    durationMs: row.durationMs,
    // Only a finished file has a size; while uploading, `uploadedBytes` is internal.
    sizeBytes: row.status === 'ready' ? row.sizeBytes : null,
    width: row.width,
    height: row.height,
    createdBy: { id: row.createdById, displayName: row.creatorName },
    startedAt: row.startedAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
  }
}

export function canAccess(viewer: Viewer, row: Pick<AccessibleRecording, 'createdById' | 'roomOwnerId'>): boolean {
  return viewer.role === 'admin' || row.createdById === viewer.id || row.roomOwnerId === viewer.id
}

/** Whether the viewer sees the recording only because they are an admin (such access is audited). */
export function isAdminOnlyAccess(viewer: Viewer, row: Pick<AccessibleRecording, 'createdById' | 'roomOwnerId'>): boolean {
  return viewer.role === 'admin' && row.createdById !== viewer.id && row.roomOwnerId !== viewer.id
}

function baseQuery() {
  return useDb()
    .select(summaryColumns)
    .from(recordings)
    .innerJoin(rooms, eq(rooms.id, recordings.roomId))
    .innerJoin(users, eq(users.id, recordings.createdBy))
}

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

async function paginate(where: SQL | undefined, query: PageQuery): Promise<Paginated<RecordingSummary>> {
  const rows = await baseQuery()
    .where(where)
    .orderBy(desc(recordings.startedAt), desc(recordings.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  const [total] = await useDb()
    .select({ value: count() })
    .from(recordings)
    .innerJoin(rooms, eq(rooms.id, recordings.roomId))
    .innerJoin(users, eq(users.id, recordings.createdBy))
    .where(where)
  return { items: rows.map(toSummary), page: query.page, pageSize: query.pageSize, total: Number(total?.value ?? 0) }
}

export function listRecordings(viewer: Viewer, query: PageQuery): Promise<Paginated<RecordingSummary>> {
  const scope = or(eq(recordings.createdBy, viewer.id), eq(rooms.ownerId, viewer.id))
  const search = query.q ? ilike(rooms.name, likePattern(query.q)) : undefined
  return paginate(and(scope, search), query)
}

export function listAllRecordings(query: PageQuery): Promise<Paginated<RecordingSummary>> {
  const pattern = query.q ? likePattern(query.q) : undefined
  const search = pattern ? or(ilike(rooms.name, pattern), ilike(users.displayName, pattern), ilike(users.email, pattern)) : undefined
  return paginate(search, query)
}

export async function findRecording(id: string): Promise<AccessibleRecording | null> {
  if (!isRecordingId(id)) return null
  const [row] = await baseQuery().where(eq(recordings.id, id)).limit(1)
  return row ?? null
}

/** The recording if the viewer may see it, otherwise 404. */
export async function loadAccessible(viewer: Viewer, id: string | undefined): Promise<AccessibleRecording> {
  const row = id ? await findRecording(id) : null
  if (!row || !canAccess(viewer, row)) throw apiError('NOT_FOUND', 404)
  return row
}

export async function getRecordingForUser(viewer: Viewer, id: string | undefined): Promise<{ recording: RecordingSummary }> {
  return { recording: toSummary(await loadAccessible(viewer, id)) }
}

export async function deleteRecording(event: H3Event | null, viewer: Viewer, id: string | undefined): Promise<void> {
  const row = await loadAccessible(viewer, id)
  if (row.status === 'recording' || row.status === 'processing') throw apiError('CONFLICT', 409, { reason: 'recording_busy' })
  const deleted = await useDb().delete(recordings).where(eq(recordings.id, row.id)).returning({ id: recordings.id })
  if (!deleted.length) throw apiError('NOT_FOUND', 404)
  await removeRecordingFiles(row.id)
  await audit(event, {
    action: 'recording.deleted',
    targetType: 'recording',
    targetId: row.id,
    details: { roomId: row.roomId, adminAccess: isAdminOnlyAccess(viewer, row) },
  })
}

/** Removes row, job and files; turns the indicator off when the row was active. Returns false when it was gone. */
async function purgeRecording(id: string, publish: PublishRoomState): Promise<boolean> {
  const [row] = await useDb()
    .delete(recordings)
    .where(eq(recordings.id, id))
    .returning({ id: recordings.id, roomId: recordings.roomId, status: recordings.status, endedAt: recordings.endedAt })
  if (!row) return false
  // The job sees its row gone and writes nothing; wait for it before removing the files it may still hold open.
  await recordingQueue().cancel(id)
  await removeRecordingFiles(id)
  if (isActive(row)) {
    try {
      await publish(row.roomId)
    } catch (error) {
      logger.warn('publishing room state after deleting an active recording failed', { roomId: row.roomId, err: error })
    }
  }
  return true
}

export async function adminDeleteRecording(
  event: H3Event | null,
  id: string | undefined,
  publish: PublishRoomState = publishRoomState,
): Promise<void> {
  const row = id ? await findRecording(id) : null
  if (!row || !(await purgeRecording(row.id, publish))) throw apiError('NOT_FOUND', 404)
  await audit(event, {
    action: 'admin.recording_deleted',
    targetType: 'recording',
    targetId: row.id,
    details: { roomId: row.roomId, status: row.status, createdBy: row.createdById },
  })
}

/** Everything the user recorded plus every recording in rooms they own. Returns the number deleted. */
export async function deleteRecordingsForUser(userId: string, publish: PublishRoomState = publishRoomState): Promise<number> {
  const rows = await useDb()
    .select({ id: recordings.id })
    .from(recordings)
    .innerJoin(rooms, eq(rooms.id, recordings.roomId))
    .where(or(eq(recordings.createdBy, userId), eq(rooms.ownerId, userId)))
  let deleted = 0
  for (const row of rows) if (await purgeRecording(row.id, publish)) deleted++
  return deleted
}
