/**
 * Applying database state to live LiveKit participants (rooms-backend, docs/API.md §7). The database is always written
 * first; these helpers then push the result.
 *
 * - `allowanceOf(row)`, `kindOf(row)`, `liveRows(meetingId)`.
 * - `pushParticipantState(room, row, parts)`: name, attributes (`role`, `kind`, `hand`, `vol`) and/or the complete
 *   permission object. A participant that is not connected yet is skipped (its next token carries the state).
 * - `muteSources(roomId, identity, sources)`: server-mutes the participant's published tracks of those sources.
 *   Used after a source was revoked, so peers see it off at once whatever LiveKit does with the old publication.
 * - `applyLivePolicy(roomId, change)`: after the room's self-unmute or screen-share policy changed. Self-unmute is
 *   materialized into every live participant's `mic_allowed` (a later "give voice" overrides it for one person);
 *   the screen-share policy re-computes every participant's sources. Revoked sources are muted.
 */
import { and, eq, inArray, ne } from 'drizzle-orm'
import type { ParticipantKind } from '#shared/schemas/livekit'
import type { TrackSourceName } from '../../contracts'
import { useDb } from '../../database/client'
import { callParticipants } from '../../database/schema'
import { ignoreMissingParticipant } from '../livekit/errors'
import { roomService } from '../livekit/room-service'
import { participantAttributes, permissionSpec, type PublishAllowance } from '../livekit/token'
import { findLiveMeeting, type ParticipantRow, type RoomRow } from '../meetings/meetings'
import { findRoomById } from '../rooms/queries'

export const LIVE_STATUSES = ['admitted', 'joined'] as const

export function allowanceOf(row: Pick<ParticipantRow, 'roomRole' | 'micAllowed' | 'cameraAllowed'>): PublishAllowance {
  return { role: row.roomRole, micAllowed: row.micAllowed, cameraAllowed: row.cameraAllowed }
}

export function kindOf(row: Pick<ParticipantRow, 'userId'>): ParticipantKind {
  return row.userId ? 'user' : 'guest'
}

export async function liveRows(meetingId: string): Promise<ParticipantRow[]> {
  return useDb()
    .select()
    .from(callParticipants)
    .where(and(eq(callParticipants.meetingId, meetingId), inArray(callParticipants.status, [...LIVE_STATUSES])))
}

export interface PushParts {
  name?: boolean
  attributes?: boolean
  permission?: boolean
}

export async function pushParticipantState(
  room: Pick<RoomRow, 'id' | 'screenSharePolicy'>,
  row: ParticipantRow,
  parts: PushParts,
): Promise<void> {
  const update: Parameters<ReturnType<typeof roomService>['updateParticipant']>[2] = {}
  if (parts.name) update.name = row.displayName
  if (parts.attributes) {
    update.attributes = participantAttributes({
      role: row.roomRole,
      kind: kindOf(row),
      handRaisedAt: row.handRaisedAt,
      volumeLevel: row.volumeLevel,
    })
  }
  if (parts.permission) update.permission = permissionSpec(allowanceOf(row), room)
  await ignoreMissingParticipant(() => roomService().updateParticipant(room.id, row.lkIdentity, update))
}

export async function muteSources(roomId: string, identity: string, sources: Iterable<TrackSourceName>): Promise<number> {
  const wanted = new Set(sources)
  if (wanted.size === 0) return 0
  const service = roomService()
  const live = await service.getParticipant(roomId, identity)
  if (!live) return 0
  let muted = 0
  for (const track of live.tracks) {
    if (track.muted || track.source === 'unknown' || !wanted.has(track.source)) continue
    await ignoreMissingParticipant(() => service.mutePublishedTrack(roomId, identity, track.sid))
    muted++
  }
  return muted
}

/** Runs one task per row concurrently; the first failure is rethrown after all of them settled. */
export async function forEachRow<T>(rows: T[], task: (row: T) => Promise<unknown>): Promise<void> {
  const results = await Promise.allSettled(rows.map(task))
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failed) throw failed.reason
}

export async function applyLivePolicy(
  roomId: string,
  change: { allowSelfUnmute?: boolean; screenSharePolicy?: 'everyone' | 'hosts' },
): Promise<void> {
  if (change.allowSelfUnmute === undefined && change.screenSharePolicy === undefined) return
  const db = useDb()
  const room = await findRoomById(roomId)
  const meeting = room ? await findLiveMeeting(db, roomId) : null
  if (!room || !meeting) return

  let targets: ParticipantRow[] = []
  if (change.allowSelfUnmute !== undefined) {
    targets = await db
      .update(callParticipants)
      .set({ micAllowed: change.allowSelfUnmute })
      .where(
        and(
          eq(callParticipants.meetingId, meeting.id),
          eq(callParticipants.roomRole, 'participant'),
          inArray(callParticipants.status, [...LIVE_STATUSES]),
          ne(callParticipants.micAllowed, change.allowSelfUnmute),
        ),
      )
      .returning()
  }
  if (change.screenSharePolicy !== undefined) {
    targets = (await liveRows(meeting.id)).filter((row) => row.roomRole === 'participant')
  }

  const revoked: TrackSourceName[] = []
  if (change.allowSelfUnmute === false) revoked.push('microphone')
  if (change.screenSharePolicy === 'hosts') revoked.push('screen_share', 'screen_share_audio')
  await forEachRow(targets, async (row) => {
    await pushParticipantState(room, row, { permission: true })
    const lost = revoked.filter((source) => source !== 'microphone' || !row.micAllowed)
    await muteSources(room.id, row.lkIdentity, lost)
  })
}
