/**
 * `publishRoomState(roomId)` (server/contracts `PublishRoomState`, rooms-backend): the single writer of LiveKit room
 * metadata. It rebuilds `RoomMetadata` from the database (room policies, the live meeting's epoch, the active
 * recording), pushes it with `updateRoomMetadata`, publishes `room.state` on the bus and returns it. Calls for the same
 * room run one after another, so the last write always reflects the latest database state. Returns null when the room
 * has no live meeting (nothing to publish). LiveKit errors propagate: callers decide how to fail.
 *
 * - `buildRoomStateFromDb(roomId)`: the metadata the room should have, or null (also used by tests).
 * - `activeRecording(db, roomId, meetingId)`: the recording shown by the REC indicator, or null. `by` is the
 *   recorder's name in the call, else their account name.
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { RoomMetadata } from '#shared/schemas/livekit'
import type { PublishRoomState } from '../../contracts'
import { useDb, type Db, type Tx } from '../../database/client'
import { callParticipants, recordings, rooms, users } from '../../database/schema'
import { eventBus } from '../../utils/event-bus'
import { findLiveMeeting } from '../meetings/meetings'
import { buildRoomMetadata, type MetadataRecording } from './metadata'
import { roomService } from './room-service'

export async function activeRecording(db: Db | Tx, roomId: string, meetingId: string): Promise<MetadataRecording | null> {
  const [row] = await db
    .select({ mode: recordings.mode, startedAt: recordings.startedAt, createdBy: recordings.createdBy, account: users.displayName })
    .from(recordings)
    .innerJoin(users, eq(users.id, recordings.createdBy))
    .where(
      and(
        eq(recordings.roomId, roomId),
        eq(recordings.meetingId, meetingId),
        eq(recordings.status, 'recording'),
        isNull(recordings.endedAt),
      ),
    )
    .orderBy(desc(recordings.startedAt))
    .limit(1)
  if (!row) return null
  const [live] = await db
    .select({ displayName: callParticipants.displayName })
    .from(callParticipants)
    .where(
      and(
        eq(callParticipants.meetingId, meetingId),
        eq(callParticipants.userId, row.createdBy),
        inArray(callParticipants.status, ['admitted', 'joined']),
      ),
    )
    .orderBy(desc(callParticipants.updatedAt))
    .limit(1)
  return { mode: row.mode, by: live?.displayName ?? row.account, startedAt: row.startedAt }
}

export async function buildRoomStateFromDb(roomId: string, db: Db | Tx = useDb()): Promise<RoomMetadata | null> {
  const [room] = await db
    .select()
    .from(rooms)
    .where(and(eq(rooms.id, roomId), isNull(rooms.deletedAt)))
    .limit(1)
  if (!room) return null
  const meeting = await findLiveMeeting(db, roomId)
  if (!meeting) return null
  return buildRoomMetadata(room, meeting, await activeRecording(db, roomId, meeting.id))
}

const queues = new Map<string, Promise<unknown>>()

function serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const run = previous.then(task, task)
  const tail = run.catch(() => undefined)
  queues.set(key, tail)
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key)
  })
  return run
}

export const publishRoomState: PublishRoomState = (roomId) =>
  serialized(roomId, async () => {
    const metadata = await buildRoomStateFromDb(roomId)
    if (!metadata) return null
    await roomService().updateRoomMetadata(roomId, JSON.stringify(metadata))
    eventBus().publish({ type: 'room.state', roomId })
    return metadata
  })
