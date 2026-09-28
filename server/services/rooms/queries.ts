/**
 * Room lookups shared by the rooms, join, lobby and calls services (rooms-backend).
 *
 * - `findRoomBySlug(slug)`, `findRoomById(id, { includeDeleted })`: soft-deleted rooms are invisible by default.
 * - `isCohost(roomId, userId)`, `roleOfUser(room, userId)`: `host` for the owner, `cohost` for a persisted co-host
 *   (`room_members`), else `participant`.
 * - `isUuid(value)`.
 */
import { and, eq, isNull } from 'drizzle-orm'
import type { ParticipantRole } from '#shared/schemas/livekit'
import { useDb, type Db, type Tx } from '../../database/client'
import { roomMembers, rooms } from '../../database/schema'
import type { RoomRow } from '../meetings/meetings'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

export async function findRoomBySlug(slug: string, db: Db | Tx = useDb()): Promise<RoomRow | null> {
  const [room] = await db
    .select()
    .from(rooms)
    .where(and(eq(rooms.slug, slug), isNull(rooms.deletedAt)))
    .limit(1)
  return room ?? null
}

export async function findRoomById(
  id: string,
  options: { includeDeleted?: boolean; db?: Db | Tx } = {},
): Promise<RoomRow | null> {
  if (!isUuid(id)) return null
  const [room] = await (options.db ?? useDb())
    .select()
    .from(rooms)
    .where(options.includeDeleted ? eq(rooms.id, id) : and(eq(rooms.id, id), isNull(rooms.deletedAt)))
    .limit(1)
  return room ?? null
}

export async function isCohost(roomId: string, userId: string, db: Db | Tx = useDb()): Promise<boolean> {
  const [row] = await db
    .select({ userId: roomMembers.userId })
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)))
    .limit(1)
  return Boolean(row)
}

export async function roleOfUser(
  room: Pick<RoomRow, 'id' | 'ownerId'>,
  userId: string,
  db: Db | Tx = useDb(),
): Promise<ParticipantRole> {
  if (room.ownerId === userId) return 'host'
  return (await isCohost(room.id, userId, db)) ? 'cohost' : 'participant'
}
