/**
 * Hourly cleanup (`maintenance:cleanup`, server-core). Deletes rows that can never be used again:
 * - sessions past their absolute (30 d) or idle (7 d) expiry;
 * - guest sessions past `expires_at`; email tokens that expired or were used;
 * - account and room invites 30 days after they expired, were revoked or were used (kept that long so owners and
 *   admins still see their status) (decision);
 * - login/room-password backoff rows untouched for 24 h (they no longer count, see server/utils/limiter.ts).
 * `cleanupCutoffs(now)` is pure; `runCleanup(now)` takes the clock as a parameter.
 */
import { lt, lte, or } from 'drizzle-orm'
import { useDb, type Db } from '../../database/client'
import { emailTokens, guestSessions, loginThrottle, roomInvites, sessions, userInvites } from '../../database/schema'
import { LOGIN_FAILURE_WINDOW_MS } from '../../utils/limiter'
import { SESSION_IDLE_TTL_MS } from './policy'

export const INVITE_GRACE_MS = 30 * 24 * 3_600_000

export interface CleanupResult {
  sessions: number
  guestSessions: number
  emailTokens: number
  userInvites: number
  roomInvites: number
  loginThrottle: number
}

export function cleanupCutoffs(now: Date) {
  return {
    now,
    idleBefore: new Date(now.getTime() - SESSION_IDLE_TTL_MS),
    inviteGraceBefore: new Date(now.getTime() - INVITE_GRACE_MS),
    throttleStaleBefore: new Date(now.getTime() - LOGIN_FAILURE_WINDOW_MS),
  }
}

export async function runCleanup(now: Date = new Date(), db: Db = useDb()): Promise<CleanupResult> {
  const c = cleanupCutoffs(now)
  const deletedSessions = await db
    .delete(sessions)
    .where(or(lte(sessions.expiresAt, now), lte(sessions.lastSeenAt, c.idleBefore)))
    .returning({ id: sessions.id })
  const deletedGuests = await db
    .delete(guestSessions)
    .where(lte(guestSessions.expiresAt, now))
    .returning({ id: guestSessions.id })
  const deletedTokens = await db
    .delete(emailTokens)
    .where(or(lte(emailTokens.expiresAt, now), lte(emailTokens.usedAt, now)))
    .returning({ id: emailTokens.id })
  const deletedUserInvites = await db
    .delete(userInvites)
    .where(
      or(
        lt(userInvites.expiresAt, c.inviteGraceBefore),
        lt(userInvites.revokedAt, c.inviteGraceBefore),
        lt(userInvites.usedAt, c.inviteGraceBefore),
      ),
    )
    .returning({ id: userInvites.id })
  const deletedRoomInvites = await db
    .delete(roomInvites)
    .where(or(lt(roomInvites.expiresAt, c.inviteGraceBefore), lt(roomInvites.revokedAt, c.inviteGraceBefore)))
    .returning({ id: roomInvites.id })
  const deletedThrottle = await db
    .delete(loginThrottle)
    .where(lt(loginThrottle.updatedAt, c.throttleStaleBefore))
    .returning({ key: loginThrottle.key })
  return {
    sessions: deletedSessions.length,
    guestSessions: deletedGuests.length,
    emailTokens: deletedTokens.length,
    userInvites: deletedUserInvites.length,
    roomInvites: deletedRoomInvites.length,
    loginThrottle: deletedThrottle.length,
  }
}
