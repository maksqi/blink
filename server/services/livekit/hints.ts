/**
 * Server hints on `blinq.srv.v1` (rooms-backend, docs/API.md §12): plain JSON `{ type }` sent with LiveKit server data
 * to specific identities only. A hint tells clients to refetch from the API; it never carries a token or a secret and
 * never triggers anything destructive. Hints are best effort: failures are logged, never thrown.
 *
 * - `sendHint(roomId, identities, type)`: nothing is sent for an empty list (LiveKit would broadcast).
 * - `hintModerators(roomId, meetingId, type)`: to the connected hosts and co-hosts of the meeting.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { DATA_TOPICS, type ServerHint } from '#shared/schemas/livekit'
import { useDb, type Db, type Tx } from '../../database/client'
import { callParticipants } from '../../database/schema'
import { logger } from '../../utils/logger'
import { roomService } from './room-service'

export async function sendHint(roomId: string, identities: string[], type: ServerHint['type']): Promise<void> {
  const destinationIdentities = [...new Set(identities)]
  if (destinationIdentities.length === 0) return
  const payload = new TextEncoder().encode(JSON.stringify({ type } satisfies ServerHint))
  try {
    await roomService().sendData(roomId, payload, { topic: DATA_TOPICS.server, destinationIdentities })
  } catch (error) {
    logger.debug('server hint not delivered', { roomId, type, err: error })
  }
}

export async function moderatorIdentities(meetingId: string, db: Db | Tx = useDb()): Promise<string[]> {
  const rows = await db
    .select({ identity: callParticipants.lkIdentity })
    .from(callParticipants)
    .where(
      and(
        eq(callParticipants.meetingId, meetingId),
        eq(callParticipants.status, 'joined'),
        inArray(callParticipants.roomRole, ['host', 'cohost']),
      ),
    )
  return rows.map((row) => row.identity)
}

export async function hintModerators(roomId: string, meetingId: string | null, type: ServerHint['type']): Promise<void> {
  if (!meetingId) return
  try {
    await sendHint(roomId, await moderatorIdentities(meetingId), type)
  } catch (error) {
    logger.debug('server hint not delivered', { roomId, type, err: error })
  }
}
