/**
 * Guest sessions (rooms-backend, docs/API.md §13): guests have no account; a per-room cookie `__Host-blinq_g_<slug>`
 * holds 32 random bytes and `guest_sessions.id` stores their sha256. Sessions last 12 h (decision).
 *
 * - `createGuestSession(db, { roomId, displayName, ip, now })` → `{ token, session }` (set the cookie after commit).
 * - `renameGuestSession(db, id, displayName)`.
 * - `guestSessionForRequest(event, room, now)`: the caller's unexpired guest session for this room, or null.
 */
import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { Db, Tx } from '../../database/client'
import { guestSessions } from '../../database/schema'
import { readGuestToken } from '../../utils/cookies'
import { hashToken, randomToken } from '../../utils/crypto'
import { findGuestSession } from '../session/callers'

export const GUEST_SESSION_TTL_MS = 12 * 3_600_000

export type GuestSessionRow = typeof guestSessions.$inferSelect

export async function createGuestSession(
  db: Db | Tx,
  input: { roomId: string; displayName: string; ip: string | null; now: Date },
): Promise<{ token: string; session: GuestSessionRow }> {
  const token = randomToken()
  const [session] = await db
    .insert(guestSessions)
    .values({
      id: hashToken(token),
      roomId: input.roomId,
      displayName: input.displayName,
      createdAt: input.now,
      expiresAt: new Date(input.now.getTime() + GUEST_SESSION_TTL_MS),
      ip: input.ip,
    })
    .returning()
  return { token, session: session! }
}

export async function renameGuestSession(db: Db | Tx, id: string, displayName: string): Promise<void> {
  await db.update(guestSessions).set({ displayName }).where(eq(guestSessions.id, id))
}

export async function guestSessionForRequest(
  event: H3Event,
  room: { id: string; slug: string },
  now: Date = new Date(),
): Promise<GuestSessionRow | null> {
  const token = readGuestToken(event, room.slug)
  return token ? findGuestSession(token, room.id, now) : null
}
