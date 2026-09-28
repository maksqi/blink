/**
 * Waiting-room events (rooms-backend, docs/API.md §6.1). Pure mapping from a request row to the `WaitingEvent` its
 * owner sees. `admitted`, `denied` and `ended` are final.
 *
 * - `waiting` → `status` while the request belongs to the live meeting (or waits for the meeting to start);
 * - `admitted`/`joined` in the live meeting → `admitted` (the caller mints the token for this row only);
 * - `denied` → `denied { reason: 'denied' }`; `removed` → `denied { reason: 'removed' }`;
 * - closed without admission while the room is locked (locking closes the lobby) → `denied { reason: 'locked' }`;
 * - anything else (cancelled, expired, the meeting ended, the room was deleted or re-keyed) → `ended`.
 */
import type { ParticipantRow } from '../meetings/meetings'

export type WaitingEventKind =
  | { event: 'status' }
  | { event: 'admitted' }
  | { event: 'denied'; reason: 'denied' | 'removed' | 'locked' }
  | { event: 'ended' }

export interface WaitingContext {
  liveMeetingId: string | null
  roomLocked: boolean
  roomDeleted: boolean
}

export function waitingEventFor(
  row: Pick<ParticipantRow, 'status' | 'meetingId' | 'admittedAt'>,
  context: WaitingContext,
): WaitingEventKind {
  const inLiveMeeting = context.liveMeetingId !== null && row.meetingId === context.liveMeetingId
  switch (row.status) {
    case 'denied':
      return { event: 'denied', reason: 'denied' }
    case 'removed':
      return { event: 'denied', reason: 'removed' }
    case 'waiting':
      if (context.roomDeleted) return { event: 'ended' }
      return inLiveMeeting || row.meetingId === null ? { event: 'status' } : { event: 'ended' }
    case 'admitted':
    case 'joined':
      return inLiveMeeting && !context.roomDeleted ? { event: 'admitted' } : { event: 'ended' }
    case 'left':
      return !row.admittedAt && context.roomLocked && !context.roomDeleted
        ? { event: 'denied', reason: 'locked' }
        : { event: 'ended' }
    default:
      return { event: 'ended' }
  }
}

export function isFinalEvent(kind: WaitingEventKind): boolean {
  return kind.event !== 'status'
}
