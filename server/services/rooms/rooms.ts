/**
 * Rooms (rooms-backend, docs/API.md §5). The creating browser generates the slug and the room key K; only the join
 * proof reaches the server and is stored as `sha256(proof)`.
 *
 * - `requireRoomAccess(userId, roomId, level)`: owners pass both levels; co-hosts pass `member` and get 403
 *   `FORBIDDEN` for `owner`; everyone else (and unknown or deleted rooms) gets 404 `ROOM_NOT_FOUND`.
 * - `createRoom(user, input)`: `limits.maxRoomsPerUser` → 409 `ROOM_LIMIT_REACHED`; a taken slug → 409 `CONFLICT`
 *   (`slug_taken`, the client retries with a new slug); `maxParticipants` clamped to `limits.maxParticipantsPerRoom`.
 * - `listRooms(userId, query)`, `roomDetails(room, userId)`.
 * - `updateRoom(room, input)`: `password: null` clears it; changes that affect a live meeting are applied to it
 *   (permissions, then `publishRoomState`).
 * - `softDeleteRoom(roomId)`: also ends a live meeting and closes pending requests (used by the admin panel too).
 * - `rotateRoomKey(room, proof)`: 409 `MEETING_LIVE` while a meeting is live; `key_version + 1`; requests waiting for
 *   the next meeting are closed (they hold the old key).
 * - `addCohost(room, userId)`, `removeCohost(room, userId)`: `room_members`; people already in the live meeting get
 *   the new role at once.
 */
import { and, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { Paginated } from '#shared/schemas/common'
import type { createRoomSchema, RoomDetails, RoomSummary, updateRoomSchema } from '#shared/schemas/rooms'
import { useDb } from '../../database/client'
import { callParticipants, meetings, roomMembers, rooms, users } from '../../database/schema'
import { apiError } from '../../utils/api-error'
import { hashToken } from '../../utils/crypto'
import { logger } from '../../utils/logger'
import { hashPassword } from '../../utils/password'
import { getSettings } from '../settings/settings'
import { applyLivePolicy, forEachRow, LIVE_STATUSES, pushParticipantState } from '../calls/live'
import { hintModerators } from '../livekit/hints'
import { publishRoomState } from '../livekit/publish-room-state'
import { closeWaiting, publishClosed } from '../lobby/lobby'
import { endMeeting, findLiveMeeting, ROOM_HARD_MAX_PARTICIPANTS, withRoomLock, type RoomRow } from '../meetings/meetings'
import { findRoomById } from './queries'

export type CreateRoomInput = z.infer<typeof createRoomSchema>
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>

export function clampMaxParticipants(requested: number | undefined, limit: number): number {
  return Math.max(2, Math.min(requested ?? ROOM_HARD_MAX_PARTICIPANTS, limit, ROOM_HARD_MAX_PARTICIPANTS))
}

export async function requireRoomAccess(
  userId: string,
  roomId: string,
  level: 'member' | 'owner',
): Promise<{ room: RoomRow; isOwner: boolean }> {
  const room = await findRoomById(roomId)
  if (!room) throw apiError('ROOM_NOT_FOUND', 404)
  if (room.ownerId === userId) return { room, isOwner: true }
  const [member] = await useDb()
    .select({ userId: roomMembers.userId })
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)))
    .limit(1)
  if (!member) throw apiError('ROOM_NOT_FOUND', 404)
  if (level === 'owner') throw apiError('FORBIDDEN', 403)
  return { room, isOwner: false }
}

async function liveStats(roomIds: string[]): Promise<Map<string, number>> {
  const stats = new Map<string, number>()
  if (roomIds.length === 0) return stats
  const db = useDb()
  const live = await db
    .select({ id: meetings.id, roomId: meetings.roomId })
    .from(meetings)
    .where(and(inArray(meetings.roomId, roomIds), isNull(meetings.endedAt)))
  if (live.length === 0) return stats
  const counts = await db
    .select({ meetingId: callParticipants.meetingId, value: count() })
    .from(callParticipants)
    .where(and(inArray(callParticipants.meetingId, live.map((m) => m.id)), eq(callParticipants.status, 'joined')))
    .groupBy(callParticipants.meetingId)
  for (const meeting of live) stats.set(meeting.roomId, counts.find((c) => c.meetingId === meeting.id)?.value ?? 0)
  return stats
}

function toRoomSummary(room: RoomRow, userId: string, stats: Map<string, number>): RoomSummary {
  const isOwner = room.ownerId === userId
  return {
    id: room.id,
    slug: room.slug,
    name: room.name,
    ephemeral: room.ephemeral,
    isOwner,
    role: isOwner ? 'host' : 'cohost',
    hasPassword: room.passwordHash !== null,
    waitingRoom: room.waitingRoom,
    live: stats.has(room.id),
    participantCount: stats.get(room.id) ?? 0,
    lastActiveAt: room.lastActiveAt?.toISOString() ?? null,
    createdAt: room.createdAt.toISOString(),
  }
}

export async function roomDetails(room: RoomRow, userId: string): Promise<RoomDetails> {
  const cohosts = await useDb()
    .select({ userId: users.id, displayName: users.displayName, email: users.email })
    .from(roomMembers)
    .innerJoin(users, eq(users.id, roomMembers.userId))
    .where(eq(roomMembers.roomId, room.id))
    .orderBy(users.displayName)
  return {
    ...toRoomSummary(room, userId, await liveStats([room.id])),
    allowGuests: room.allowGuests,
    muteOnJoin: room.muteOnJoin,
    allowSelfUnmute: room.allowSelfUnmute,
    screenSharePolicy: room.screenSharePolicy,
    chatEnabled: room.chatEnabled,
    maxParticipants: room.maxParticipants,
    locked: room.locked,
    keyVersion: room.keyVersion,
    cohosts,
  }
}

export async function createRoom(user: { id: string }, input: CreateRoomInput, now: Date = new Date()): Promise<RoomDetails> {
  const settings = await getSettings()
  const passwordHash = input.password ? await hashPassword(input.password) : null
  const room = await useDb().transaction(async (tx) => {
    // Serializes one user's creations, so parallel requests cannot pass the room limit together.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`blinq:user-rooms:${user.id}`}, 0))`)
    const [owned] = await tx
      .select({ value: count() })
      .from(rooms)
      .where(and(eq(rooms.ownerId, user.id), isNull(rooms.deletedAt)))
    if ((owned?.value ?? 0) >= settings['limits.maxRoomsPerUser']) throw apiError('ROOM_LIMIT_REACHED', 409)
    const [row] = await tx
      .insert(rooms)
      .values({
        slug: input.slug,
        name: input.name,
        ownerId: user.id,
        joinProofHash: hashToken(input.proof),
        passwordHash,
        ephemeral: input.ephemeral,
        waitingRoom: input.waitingRoom,
        allowGuests: input.allowGuests,
        muteOnJoin: input.muteOnJoin,
        allowSelfUnmute: input.allowSelfUnmute,
        screenSharePolicy: input.screenSharePolicy,
        chatEnabled: input.chatEnabled,
        maxParticipants: clampMaxParticipants(input.maxParticipants, settings['limits.maxParticipantsPerRoom']),
        createdAt: now,
      })
      .onConflictDoNothing({ target: rooms.slug })
      .returning()
    if (!row) throw apiError('CONFLICT', 409, { reason: 'slug_taken' })
    return row
  })
  return roomDetails(room, user.id)
}

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

export async function listRooms(
  userId: string,
  query: { page: number; pageSize: number; q?: string },
): Promise<Paginated<RoomSummary>> {
  const db = useDb()
  const memberOf = db.select({ id: roomMembers.roomId }).from(roomMembers).where(eq(roomMembers.userId, userId))
  const where = and(
    isNull(rooms.deletedAt),
    or(eq(rooms.ownerId, userId), inArray(rooms.id, memberOf)),
    query.q ? or(ilike(rooms.name, likePattern(query.q)), ilike(rooms.slug, likePattern(query.q))) : undefined,
  )
  const [total] = await db.select({ value: count() }).from(rooms).where(where)
  const rows = await db
    .select()
    .from(rooms)
    .where(where)
    .orderBy(desc(sql`coalesce(${rooms.lastActiveAt}, ${rooms.createdAt})`), desc(rooms.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  const stats = await liveStats(rows.map((room) => room.id))
  return {
    items: rows.map((room) => toRoomSummary(room, userId, stats)),
    page: query.page,
    pageSize: query.pageSize,
    total: total?.value ?? 0,
  }
}

const LIVE_KEYS = ['waitingRoom', 'allowSelfUnmute', 'screenSharePolicy', 'chatEnabled'] as const

export async function updateRoom(room: RoomRow, input: UpdateRoomInput): Promise<RoomRow> {
  const settings = await getSettings()
  const set: Partial<typeof rooms.$inferInsert> = {}
  if (input.name !== undefined) set.name = input.name
  if (input.waitingRoom !== undefined) set.waitingRoom = input.waitingRoom
  if (input.allowGuests !== undefined) set.allowGuests = input.allowGuests
  if (input.muteOnJoin !== undefined) set.muteOnJoin = input.muteOnJoin
  if (input.allowSelfUnmute !== undefined) set.allowSelfUnmute = input.allowSelfUnmute
  if (input.screenSharePolicy !== undefined) set.screenSharePolicy = input.screenSharePolicy
  if (input.chatEnabled !== undefined) set.chatEnabled = input.chatEnabled
  if (input.maxParticipants !== undefined) {
    set.maxParticipants = clampMaxParticipants(input.maxParticipants, settings['limits.maxParticipantsPerRoom'])
  }
  if (input.password === null) set.passwordHash = null
  else if (input.password !== undefined) set.passwordHash = await hashPassword(input.password)
  if (Object.keys(set).length === 0) return room

  const [updated] = await useDb()
    .update(rooms)
    .set(set)
    .where(and(eq(rooms.id, room.id), isNull(rooms.deletedAt)))
    .returning()
  if (!updated) throw apiError('ROOM_NOT_FOUND', 404)

  if (LIVE_KEYS.some((key) => set[key] !== undefined && set[key] !== room[key])) {
    try {
      if (await findLiveMeeting(useDb(), room.id)) {
        await applyLivePolicy(room.id, {
          allowSelfUnmute: updated.allowSelfUnmute !== room.allowSelfUnmute ? updated.allowSelfUnmute : undefined,
          screenSharePolicy: updated.screenSharePolicy !== room.screenSharePolicy ? updated.screenSharePolicy : undefined,
        })
        await publishRoomState(room.id)
      }
    } catch (error) {
      // The database holds the new settings; the live meeting catches up with the next change or join.
      logger.warn('applying room settings to the live meeting failed', { roomId: room.id, err: error })
    }
  }
  return updated
}

export async function softDeleteRoom(roomId: string, now: Date = new Date()): Promise<boolean> {
  const closed = await withRoomLock(roomId, async (tx) => {
    const [row] = await tx
      .update(rooms)
      .set({ deletedAt: now })
      .where(and(eq(rooms.id, roomId), isNull(rooms.deletedAt)))
      .returning({ id: rooms.id })
    if (!row) return null
    return closeWaiting(and(eq(callParticipants.roomId, roomId), isNull(callParticipants.meetingId))!, now, tx)
  })
  if (closed === null) return false
  publishClosed(closed)
  await endMeeting(roomId, { reason: 'room_deleted', now })
  return true
}

export async function rotateRoomKey(room: RoomRow, proof: string, now: Date = new Date()): Promise<RoomRow> {
  const { row, closed } = await withRoomLock(room.id, async (tx) => {
    if (await findLiveMeeting(tx, room.id)) throw apiError('MEETING_LIVE', 409)
    const [updated] = await tx
      .update(rooms)
      .set({ joinProofHash: hashToken(proof), keyVersion: sql`${rooms.keyVersion} + 1` })
      .where(and(eq(rooms.id, room.id), isNull(rooms.deletedAt)))
      .returning()
    if (!updated) throw apiError('ROOM_NOT_FOUND', 404)
    const closedIds = await closeWaiting(and(eq(callParticipants.roomId, room.id), isNull(callParticipants.meetingId))!, now, tx)
    return { row: updated, closed: closedIds }
  })
  publishClosed(closed)
  return row
}

async function applyLiveRole(room: RoomRow, userId: string, role: 'cohost' | 'participant'): Promise<void> {
  const meeting = await findLiveMeeting(useDb(), room.id)
  if (!meeting) return
  const rows = await useDb()
    .update(callParticipants)
    .set({ roomRole: role, ...(role === 'cohost' ? { micAllowed: true, cameraAllowed: true } : {}) })
    .where(
      and(
        eq(callParticipants.meetingId, meeting.id),
        eq(callParticipants.userId, userId),
        inArray(callParticipants.status, [...LIVE_STATUSES]),
        eq(callParticipants.roomRole, role === 'cohost' ? 'participant' : 'cohost'),
      ),
    )
    .returning()
  if (rows.length === 0) return
  try {
    await forEachRow(rows, (row) => pushParticipantState(room, row, { attributes: true, permission: true }))
  } catch (error) {
    logger.warn('applying a co-host change to the live meeting failed', { roomId: room.id, err: error })
  }
  await hintModerators(room.id, meeting.id, 'participant.changed')
}

export async function addCohost(room: RoomRow, userId: string): Promise<void> {
  if (userId === room.ownerId) throw apiError('CONFLICT', 409, { reason: 'self' })
  const db = useDb()
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.disabledAt)))
    .limit(1)
  if (!user) throw apiError('NOT_FOUND', 404)
  const [inserted] = await db
    .insert(roomMembers)
    .values({ roomId: room.id, userId, role: 'cohost' })
    .onConflictDoNothing()
    .returning({ userId: roomMembers.userId })
  if (!inserted) throw apiError('CONFLICT', 409, { reason: 'already_cohost' })
  await applyLiveRole(room, userId, 'cohost')
}

export async function removeCohost(room: RoomRow, userId: string): Promise<void> {
  const deleted = await useDb()
    .delete(roomMembers)
    .where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId)))
    .returning({ userId: roomMembers.userId })
  if (deleted.length === 0) throw apiError('NOT_FOUND', 404)
  await applyLiveRole(room, userId, 'participant')
}
