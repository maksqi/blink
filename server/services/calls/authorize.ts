/**
 * In-call authorization (rooms-backend, docs/API.md §1.1 and §7, docs/SECURITY.md §4). The server is the enforcement
 * point of the permission matrix in `shared/utils/permissions.ts`.
 *
 * `authorizeCall(event, roomId, action, { targetIdentity })` (`action` null = any caller, e.g. the participant list):
 * 1. `resolveCaller` → the caller's own row in the room's live meeting, else 403 `CALL_NOT_PARTICIPANT`;
 * 2. the `call-actions` limiter (per participant row);
 * 3. `decideCallAccess`: an action the caller's role can never perform is 403 `CALL_FORBIDDEN` before any target
 *    lookup (so it reveals nothing about targets); an unknown target (not live in the same meeting) is 404
 *    `NOT_FOUND`; a target the caller may not act on (the host, themselves) is 403 `CALL_FORBIDDEN`.
 * Returns the caller row, the `CallActor`, the target row and the room.
 */
import { and, eq, inArray } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { canPerform, type CallAction, type CallActor, type CallTarget } from '#shared/utils/permissions'
import { useDb } from '../../database/client'
import { callParticipants } from '../../database/schema'
import { apiError } from '../../utils/api-error'
import { resolveCaller } from '../../utils/auth'
import { consumeOr429 } from '../../utils/limiter'
import { isIdentity } from '../livekit/token'
import type { ParticipantRow, RoomRow } from '../meetings/meetings'
import { findRoomById } from '../rooms/queries'
import { kindOf, LIVE_STATUSES } from './live'

export type CallAccess = 'ok' | 'forbidden' | 'not_found'

export function isTargetedAction(action: CallAction): boolean {
  return action.startsWith('participant.')
}

export function actorOf(row: Pick<ParticipantRow, 'lkIdentity' | 'roomRole' | 'userId'>): CallActor {
  return { identity: row.lkIdentity, role: row.roomRole, kind: kindOf(row) }
}

/** Pure decision; `target` null means "no live participant with that identity". */
export function decideCallAccess(actor: CallActor, action: CallAction, target?: CallTarget | null): CallAccess {
  // Role-level check first, with a neutral stand-in target.
  if (!canPerform(actor, action, { identity: '', role: 'participant' })) return 'forbidden'
  if (!isTargetedAction(action)) return 'ok'
  if (!target) return 'not_found'
  return canPerform(actor, action, target) ? 'ok' : 'forbidden'
}

export interface CallContext {
  caller: ParticipantRow
  actor: CallActor
  room: RoomRow
  meetingId: string
  target: ParticipantRow | null
}

export async function findLiveTarget(meetingId: string, identity: string): Promise<ParticipantRow | null> {
  if (!isIdentity(identity)) return null
  const [row] = await useDb()
    .select()
    .from(callParticipants)
    .where(
      and(
        eq(callParticipants.meetingId, meetingId),
        eq(callParticipants.lkIdentity, identity),
        inArray(callParticipants.status, [...LIVE_STATUSES]),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function authorizeCall(
  event: H3Event,
  roomId: string,
  action: CallAction | null,
  options: { targetIdentity?: string } = {},
): Promise<CallContext> {
  const caller = await resolveCaller(event, roomId)
  if (!caller.meetingId) throw apiError('CALL_NOT_PARTICIPANT', 403)
  consumeOr429(event, 'call-actions', `participant:${caller.id}`)
  const actor = actorOf(caller)

  let target: ParticipantRow | null = null
  let decision: CallAccess = action ? decideCallAccess(actor, action, isTargetedAction(action) ? null : undefined) : 'ok'
  if (action && decision === 'not_found') {
    target = options.targetIdentity ? await findLiveTarget(caller.meetingId, options.targetIdentity) : null
    decision = decideCallAccess(actor, action, target ? { identity: target.lkIdentity, role: target.roomRole } : null)
  }
  if (decision === 'forbidden') throw apiError('CALL_FORBIDDEN', 403)
  if (decision === 'not_found') throw apiError('NOT_FOUND', 404)

  const room = await findRoomById(roomId)
  if (!room) throw apiError('CALL_NOT_PARTICIPANT', 403)
  return { caller, actor, room, meetingId: caller.meetingId, target }
}
