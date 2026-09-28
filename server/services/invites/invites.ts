/**
 * Room invites (rooms-backend, docs/API.md §5). Owners and co-hosts manage them; the token is re-derived on every
 * read and never stored.
 *
 * - `listInvites(roomId)`, `createInvite(roomId, createdBy, input, now)`, `revokeInvite(roomId, inviteId, now)`.
 * - `findInviteByToken(roomId, token)`: the invite behind a token of this room (MAC verified), or null.
 * - `consumeInvite(tx, roomId, inviteId, now)`: one use, atomically (`UPDATE … WHERE use_count < max_uses RETURNING`);
 *   false when the invite is revoked, expired or used up by then. Called once per new participant row.
 */
import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import type { RoomInvite } from '#shared/schemas/rooms'
import { useDb, type Db, type Tx } from '../../database/client'
import { roomInvites } from '../../database/schema'
import { inviteExpiresAt, type InviteExpiry } from './policy'
import { inviteIdFromToken, inviteTokenFor } from './token'

export type InviteRow = typeof roomInvites.$inferSelect

export const MAX_LISTED_INVITES = 200

export function toRoomInvite(row: InviteRow): RoomInvite {
  return {
    id: row.id,
    label: row.label,
    token: inviteTokenFor(row.id),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    maxUses: row.maxUses,
    useCount: row.useCount,
    revoked: row.revokedAt !== null,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function listInvites(roomId: string): Promise<RoomInvite[]> {
  const rows = await useDb()
    .select()
    .from(roomInvites)
    .where(eq(roomInvites.roomId, roomId))
    .orderBy(desc(roomInvites.createdAt))
    .limit(MAX_LISTED_INVITES)
  return rows.map(toRoomInvite)
}

export async function createInvite(
  roomId: string,
  createdBy: string,
  input: { label?: string; expiresIn: InviteExpiry; maxUses: number | null },
  now: Date = new Date(),
): Promise<RoomInvite> {
  const [row] = await useDb()
    .insert(roomInvites)
    .values({
      roomId,
      label: input.label ? input.label : null,
      createdBy,
      expiresAt: inviteExpiresAt(input.expiresIn, now),
      maxUses: input.maxUses,
      createdAt: now,
    })
    .returning()
  return toRoomInvite(row!)
}

/** False when no invite with this id belongs to the room. Revoking twice is fine. */
export async function revokeInvite(roomId: string, inviteId: string, now: Date = new Date()): Promise<boolean> {
  const [row] = await useDb()
    .update(roomInvites)
    .set({ revokedAt: sql`coalesce(${roomInvites.revokedAt}, ${now.toISOString()}::timestamptz)` })
    .where(and(eq(roomInvites.id, inviteId), eq(roomInvites.roomId, roomId)))
    .returning({ id: roomInvites.id })
  return Boolean(row)
}

export async function findInviteByToken(roomId: string, token: string, db: Db | Tx = useDb()): Promise<InviteRow | null> {
  const inviteId = inviteIdFromToken(token)
  if (!inviteId) return null
  const [row] = await db
    .select()
    .from(roomInvites)
    .where(and(eq(roomInvites.id, inviteId), eq(roomInvites.roomId, roomId)))
    .limit(1)
  return row ?? null
}

export async function consumeInvite(tx: Db | Tx, roomId: string, inviteId: string, now: Date = new Date()): Promise<boolean> {
  const [row] = await tx
    .update(roomInvites)
    .set({ useCount: sql`${roomInvites.useCount} + 1` })
    .where(
      and(
        eq(roomInvites.id, inviteId),
        eq(roomInvites.roomId, roomId),
        isNull(roomInvites.revokedAt),
        or(isNull(roomInvites.expiresAt), gt(roomInvites.expiresAt, now)),
        or(isNull(roomInvites.maxUses), lt(roomInvites.useCount, roomInvites.maxUses)),
      ),
    )
    .returning({ id: roomInvites.id })
  return Boolean(row)
}
