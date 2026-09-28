/**
 * Caller lookups for `resolveCaller` (server-core): who is making an in-call request.
 *
 * - `roomSlugForId(roomId)`: slug of a non-deleted room (the guest cookie name depends on it).
 * - `findGuestSession(token, roomId)`: the unexpired guest session behind a guest cookie.
 * - `findActiveParticipant(roomId, who, clientId?)`: the caller's own `call_participants` row in the room's live
 *   meeting (status `admitted` or `joined`). With several tabs and no `clientId`, the most recently joined row wins
 *   (decision).
 */
import { and, desc, eq, getTableColumns, gt, inArray, isNull, sql } from 'drizzle-orm'
import { useDb } from '../../database/client'
import { callParticipants, guestSessions, meetings, rooms } from '../../database/schema'
import { hashToken, isOpaqueToken } from '../../utils/crypto'

export type CallParticipant = typeof callParticipants.$inferSelect

export type CallerIdentity = { userId: string } | { guestSessionId: string }

export async function roomSlugForId(roomId: string): Promise<string | null> {
  const [room] = await useDb()
    .select({ slug: rooms.slug })
    .from(rooms)
    .where(and(eq(rooms.id, roomId), isNull(rooms.deletedAt)))
    .limit(1)
  return room?.slug ?? null
}

export async function findGuestSession(token: string, roomId: string, now: Date = new Date()) {
  if (!isOpaqueToken(token)) return null
  const [guest] = await useDb()
    .select()
    .from(guestSessions)
    .where(and(eq(guestSessions.id, hashToken(token)), eq(guestSessions.roomId, roomId), gt(guestSessions.expiresAt, now)))
    .limit(1)
  return guest ?? null
}

export async function findActiveParticipant(
  roomId: string,
  who: CallerIdentity,
  clientId?: string,
): Promise<CallParticipant | null> {
  const identity =
    'userId' in who ? eq(callParticipants.userId, who.userId) : eq(callParticipants.guestSessionId, who.guestSessionId)
  const [row] = await useDb()
    .select(getTableColumns(callParticipants))
    .from(callParticipants)
    .innerJoin(meetings, and(eq(meetings.id, callParticipants.meetingId), isNull(meetings.endedAt)))
    .where(
      and(
        eq(callParticipants.roomId, roomId),
        identity,
        inArray(callParticipants.status, ['admitted', 'joined']),
        clientId ? eq(callParticipants.clientId, clientId) : undefined,
      ),
    )
    .orderBy(desc(sql`coalesce(${callParticipants.joinedAt}, ${callParticipants.admittedAt}, ${callParticipants.createdAt})`))
    .limit(1)
  return row ?? null
}
