/**
 * Rooms maintenance (rooms-backend), run every minute by server/plugins/rooms.ts and as the `rooms:maintenance` task:
 * - waiting requests older than 1 h are closed (their streams get `ended`);
 * - live meetings whose LiveKit room is gone are ended (a lost `room_finished` webhook would otherwise leave them live
 *   and hand out tokens for a room that no longer exists). Only meetings this server created (with a LiveKit sid) and
 *   older than 2 minutes are checked; nothing is ended while LiveKit is unreachable;
 * - instant meetings that never started are archived after 24 h (decision).
 * `runRoomsMaintenance(now)` takes the clock as a parameter; `scope.roomIds` limits a step to some rooms (tests).
 */
import { and, eq, inArray, isNotNull, isNull, lt, notExists } from 'drizzle-orm'
import { useDb } from '../../database/client'
import { meetings, rooms } from '../../database/schema'
import { logger } from '../../utils/logger'
import { roomService } from '../livekit/room-service'
import { closeStaleWaiting } from '../lobby/lobby'
import { softDeleteRoom } from '../rooms/rooms'
import { endMeeting } from './meetings'

export const RECONCILE_MIN_AGE_MS = 120_000
export const IDLE_EPHEMERAL_TTL_MS = 24 * 3_600_000

export interface MaintenanceScope {
  roomIds?: string[]
}

export async function reconcileLiveMeetings(now: Date = new Date(), scope: MaintenanceScope = {}): Promise<number> {
  const live = await useDb()
    .select({ roomId: meetings.roomId, sid: meetings.livekitSid })
    .from(meetings)
    .where(
      and(
        isNull(meetings.endedAt),
        isNotNull(meetings.livekitSid),
        lt(meetings.startedAt, new Date(now.getTime() - RECONCILE_MIN_AGE_MS)),
        scope.roomIds ? inArray(meetings.roomId, scope.roomIds) : undefined,
      ),
    )
  if (live.length === 0) return 0
  let present: Map<string, string>
  try {
    const listed = await roomService().listRooms(live.map((m) => m.roomId))
    present = new Map(listed.map((room) => [room.name, room.sid]))
  } catch (error) {
    logger.debug('LiveKit unreachable, meetings not reconciled', { err: error })
    return 0
  }
  let ended = 0
  for (const meeting of live) {
    if (present.get(meeting.roomId) === meeting.sid) continue
    const done = await endMeeting(meeting.roomId, {
      reason: 'stale',
      livekitSid: meeting.sid ?? undefined,
      deleteLivekitRoom: false,
      now,
    })
    if (done) ended++
  }
  return ended
}

export async function archiveIdleEphemeralRooms(now: Date = new Date(), scope: MaintenanceScope = {}): Promise<number> {
  const db = useDb()
  const idle = await db
    .select({ id: rooms.id })
    .from(rooms)
    .where(
      and(
        scope.roomIds ? inArray(rooms.id, scope.roomIds) : undefined,
        eq(rooms.ephemeral, true),
        isNull(rooms.deletedAt),
        lt(rooms.createdAt, new Date(now.getTime() - IDLE_EPHEMERAL_TTL_MS)),
        notExists(db.select({ id: meetings.id }).from(meetings).where(and(eq(meetings.roomId, rooms.id), isNull(meetings.endedAt)))),
      ),
    )
  let archived = 0
  for (const room of idle) if (await softDeleteRoom(room.id, now)) archived++
  return archived
}

export async function runRoomsMaintenance(now: Date = new Date()) {
  const staleWaiting = await closeStaleWaiting(now)
  const reconciled = await reconcileLiveMeetings(now)
  const archived = await archiveIdleEphemeralRooms(now)
  return { staleWaiting, reconciled, archived }
}
