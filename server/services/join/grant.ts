/**
 * `JoinGrant` for a participant row (rooms-backend, docs/API.md §6): a fresh 5-minute LiveKit token for the row's own
 * identity plus the LiveKit URL and the meeting epoch. Used by `POST /api/join/:slug` (direct admission and resume) and
 * by the waiting-room SSE (`admitted`), which mints it only for the stream owner's row.
 */
import type { JoinGrant } from '#shared/schemas/join'
import { env } from '../../utils/env'
import { allowanceOf, kindOf } from '../calls/live'
import { buildParticipantToken } from '../livekit/token'
import type { MeetingRow, ParticipantRow, RoomRow } from '../meetings/meetings'

export async function buildJoinGrant(
  room: Pick<RoomRow, 'id' | 'screenSharePolicy'>,
  meeting: Pick<MeetingRow, 'epoch'>,
  row: ParticipantRow,
): Promise<JoinGrant> {
  const config = env()
  const token = await buildParticipantToken({
    apiKey: config.LIVEKIT_API_KEY,
    apiSecret: config.LIVEKIT_API_SECRET,
    roomName: room.id,
    identity: row.lkIdentity,
    name: row.displayName,
    ...allowanceOf(row),
    kind: kindOf(row),
    handRaisedAt: row.handRaisedAt,
    volumeLevel: row.volumeLevel,
    policy: room,
  })
  return {
    status: 'admitted',
    token,
    url: config.LIVEKIT_PUBLIC_URL,
    epoch: meeting.epoch,
    identity: row.lkIdentity,
    role: row.roomRole,
    roomId: room.id,
  }
}
