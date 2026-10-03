/**
 * Admin view of rooms (Stage 03): metadata only, never keys, proofs, invite tokens, chat or media.
 *
 * - `listAdminRooms(query)` → `Paginated<AdminRoom>`: rooms that are not deleted, `q` over the room name, slug, owner
 *   name and owner email; live rooms first, then the most recently active. `live` and `participantCount` come from
 *   LiveKit `listRooms` for the rooms on the page. When LiveKit cannot be reached, `live` comes from the meeting row
 *   and the count from the meeting's `joined` rows, so the list always renders (never a 500).
 * - `mergeLiveState(rows, livekit)`: pure; `fetchLiveRooms(service, names)`: the LiveKit answer, or null on failure.
 * - `endRoomByAdmin(roomId, actor)`: ends the live meeting through the meetings service (LiveKit `DeleteRoom`,
 *   waiting requests get `ended`). 404 `NOT_FOUND` for unknown or deleted rooms, 409 `CONFLICT` (`not_live`) without a
 *   live meeting (decision). Audit `admin.room_ended`.
 * - `deleteRoomByAdmin(roomId, actor)`: soft delete through the rooms service (also ends a live meeting). 404
 *   `NOT_FOUND`. Audit `admin.room_deleted`.
 * - `listAdminRoomMeetings(roomId, query)` → `Paginated<MeetingSummary>`; deleted rooms keep their history
 *   (decision). 404 `NOT_FOUND` for unknown rooms.
 */
import { and, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
import type { AdminRoom } from '#shared/schemas/admin'
import type { Paginated } from '#shared/schemas/common'
import type { MeetingSummary } from '#shared/schemas/rooms'
import type { LiveRoomInfo, RoomServiceAdapter } from '../../contracts'
import { useDb } from '../../database/client'
import { callParticipants, meetings, rooms, users } from '../../database/schema'
import { apiError } from '../../utils/api-error'
import { logger } from '../../utils/logger'
import { audit } from '../audit/audit'
import { roomService } from '../livekit/room-service'
import { endMeeting, listMeetings } from '../meetings/meetings'
import { findRoomById } from '../rooms/queries'
import { softDeleteRoom } from '../rooms/rooms'
import { assertAdminActor, likePattern, type AdminActor } from './common'

export interface PageQuery {
  page: number
  pageSize: number
  q?: string
}

/** One room as read from the database, before LiveKit is asked. */
export interface AdminRoomRow {
  id: string
  slug: string
  name: string
  ephemeral: boolean
  createdAt: Date
  lastActiveAt: Date | null
  owner: { id: string; displayName: string; email: string }
  /** A meeting row without `ended_at` exists. */
  liveInDb: boolean
  /** `joined` rows of that meeting. */
  joinedInDb: number
}

/** Pure. With a LiveKit answer, the room is live while LiveKit has it; without one, the database decides. */
export function mergeLiveState(rows: AdminRoomRow[], livekit: ReadonlyMap<string, LiveRoomInfo> | null): AdminRoom[] {
  return rows.map((row) => {
    const live = livekit ? livekit.get(row.id) : undefined
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      owner: { id: row.owner.id, displayName: row.owner.displayName, email: row.owner.email },
      live: livekit ? live !== undefined : row.liveInDb,
      participantCount: livekit ? (live?.numParticipants ?? 0) : row.liveInDb ? row.joinedInDb : 0,
      ephemeral: row.ephemeral,
      createdAt: row.createdAt.toISOString(),
      lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
    }
  })
}

/** LiveKit rooms by name (= room id), or null when LiveKit fails (logged, never thrown). */
export async function fetchLiveRooms(
  service: Pick<RoomServiceAdapter, 'listRooms'>,
  names: string[],
): Promise<Map<string, LiveRoomInfo> | null> {
  if (names.length === 0) return new Map()
  try {
    const live = await service.listRooms(names)
    return new Map(live.filter((room) => names.includes(room.name)).map((room) => [room.name, room]))
  } catch (error) {
    logger.warn('LiveKit listRooms failed; admin room list uses database counts', { err: error })
    return null
  }
}

function searchCondition(q: string | undefined): SQL | undefined {
  if (!q) return undefined
  const pattern = likePattern(q)
  return or(
    ilike(rooms.name, pattern),
    ilike(rooms.slug, pattern),
    ilike(users.displayName, pattern),
    ilike(users.email, pattern),
  )
}

export async function listAdminRooms(
  query: PageQuery,
  service: Pick<RoomServiceAdapter, 'listRooms'> = roomService(),
): Promise<Paginated<AdminRoom>> {
  const db = useDb()
  const where = and(isNull(rooms.deletedAt), searchCondition(query.q))
  const joinedInDb = sql<number>`(select count(*)::int from ${callParticipants} where ${callParticipants.meetingId} = ${meetings.id} and ${callParticipants.status} = 'joined')`
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: rooms.id,
        slug: rooms.slug,
        name: rooms.name,
        ephemeral: rooms.ephemeral,
        createdAt: rooms.createdAt,
        lastActiveAt: rooms.lastActiveAt,
        ownerId: users.id,
        ownerName: users.displayName,
        ownerEmail: users.email,
        meetingId: meetings.id,
        joinedInDb,
      })
      .from(rooms)
      .innerJoin(users, eq(users.id, rooms.ownerId))
      // At most one live meeting per room (partial unique index), so this join never multiplies rows.
      .leftJoin(meetings, and(eq(meetings.roomId, rooms.id), isNull(meetings.endedAt)))
      .where(where)
      .orderBy(
        sql`${meetings.id} is null`,
        desc(sql`coalesce(${rooms.lastActiveAt}, ${rooms.createdAt})`),
        desc(rooms.id),
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ n: count() })
      .from(rooms)
      .innerJoin(users, eq(users.id, rooms.ownerId))
      .where(where),
  ])
  const pageRows: AdminRoomRow[] = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    ephemeral: row.ephemeral,
    createdAt: row.createdAt,
    lastActiveAt: row.lastActiveAt,
    owner: { id: row.ownerId, displayName: row.ownerName, email: row.ownerEmail },
    liveInDb: row.meetingId !== null,
    joinedInDb: Number(row.joinedInDb ?? 0),
  }))
  const livekit = await fetchLiveRooms(
    service,
    pageRows.map((row) => row.id),
  )
  return {
    items: mergeLiveState(pageRows, livekit),
    page: query.page,
    pageSize: query.pageSize,
    total: total?.n ?? 0,
  }
}

const notFound = () => apiError('NOT_FOUND', 404)

export async function endRoomByAdmin(roomId: string, actor: AdminActor): Promise<void> {
  const now = assertAdminActor(actor)
  const room = await findRoomById(roomId)
  if (!room) throw notFound()
  const ended = await endMeeting(room.id, { reason: 'admin', now })
  if (!ended) throw apiError('CONFLICT', 409, { reason: 'not_live' })
  await audit(
    actor.event,
    {
      action: 'admin.room_ended',
      actorUserId: actor.user.id,
      targetType: 'room',
      targetId: room.id,
      details: { name: room.name, ownerId: room.ownerId },
    },
    { now },
  )
}

export async function deleteRoomByAdmin(roomId: string, actor: AdminActor): Promise<void> {
  const now = assertAdminActor(actor)
  const room = await findRoomById(roomId)
  if (!room) throw notFound()
  if (!(await softDeleteRoom(room.id, now))) throw notFound()
  await audit(
    actor.event,
    {
      action: 'admin.room_deleted',
      actorUserId: actor.user.id,
      targetType: 'room',
      targetId: room.id,
      details: { name: room.name, ownerId: room.ownerId },
    },
    { now },
  )
}

export async function listAdminRoomMeetings(roomId: string, query: PageQuery): Promise<Paginated<MeetingSummary>> {
  const room = await findRoomById(roomId, { includeDeleted: true })
  if (!room) throw notFound()
  return listMeetings(room.id, { page: query.page, pageSize: query.pageSize })
}
