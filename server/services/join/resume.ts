/**
 * Resume (rooms-backend, docs/API.md §6, docs/ARCHITECTURE.md §6.2): a refresh or a reconnect after the 5-minute
 * token TTL gets a new token for the same row and identity, without the lobby, only when the same user session or
 * guest session sends the same `clientId` (per tab) for the room's live meeting.
 *
 * `resumeKind(row, context)` (pure):
 * - `grant` for an `admitted` or `joined` row of the live meeting, and for a row of the live meeting that was admitted
 *   and then `left` less than `RESUME_GRACE_MS` ago: a page reload closes the old connection before the reloaded page
 *   asks again (decision);
 * - `waiting` for the caller's own pending request (a reload in the waiting room reuses it instead of queueing twice);
 * - null otherwise: rows of older meetings, removed or denied rows, requests closed without admission.
 * Resume is checked right after the proof and never consumes an invite.
 */
import type { ParticipantRow } from '../meetings/meetings'

export const RESUME_GRACE_MS = 120_000

export type ResumeKind = 'grant' | 'waiting'

export interface ResumeContext {
  liveMeetingId: string | null
  clientId: string
  now: Date
}

export function resumeKind(
  row: Pick<ParticipantRow, 'status' | 'meetingId' | 'clientId' | 'admittedAt' | 'leftAt'>,
  context: ResumeContext,
): ResumeKind | null {
  if (row.clientId !== context.clientId) return null
  const inLiveMeeting = context.liveMeetingId !== null && row.meetingId === context.liveMeetingId
  switch (row.status) {
    case 'admitted':
    case 'joined':
      return inLiveMeeting ? 'grant' : null
    case 'left':
      if (!inLiveMeeting || !row.admittedAt || !row.leftAt) return null
      return context.now.getTime() - row.leftAt.getTime() <= RESUME_GRACE_MS ? 'grant' : null
    case 'waiting':
      return inLiveMeeting || row.meetingId === null ? 'waiting' : null
    default:
      return null
  }
}

/** The first resumable row, newest first. */
export function pickResumable<T extends Parameters<typeof resumeKind>[0]>(
  rows: readonly T[],
  context: ResumeContext,
): { row: T; kind: ResumeKind } | null {
  for (const row of rows) {
    const kind = resumeKind(row, context)
    if (kind) return { row, kind }
  }
  return null
}
