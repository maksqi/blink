/**
 * Session lifetime rules (server-core, docs/API.md §13, docs/SECURITY.md §4). Pure functions with an explicit `now`.
 *
 * - Absolute lifetime 30 days (`expires_at`), idle lifetime 7 days (`last_seen_at`).
 * - `last_seen_at` is written at most once per minute (decision), so idle expiry is accurate to a minute.
 * - Validated sessions are cached in-process for at most 30 seconds.
 */
export const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 3_600_000
export const SESSION_IDLE_TTL_MS = 7 * 24 * 3_600_000
export const SESSION_TOUCH_INTERVAL_MS = 60_000
export const SESSION_CACHE_TTL_MS = 30_000

export type SessionInvalidReason = 'expired' | 'idle' | 'disabled'

export interface SessionTimes {
  expiresAt: Date
  lastSeenAt: Date
}

export function sessionExpiresAt(now: Date): Date {
  return new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS)
}

/** Why a session can no longer be used at `now`, or null while it is valid. */
export function sessionInvalidReason(
  session: SessionTimes,
  user: { disabledAt: Date | null },
  now: Date,
): SessionInvalidReason | null {
  if (session.expiresAt.getTime() <= now.getTime()) return 'expired'
  if (session.lastSeenAt.getTime() + SESSION_IDLE_TTL_MS <= now.getTime()) return 'idle'
  if (user.disabledAt) return 'disabled'
  return null
}

export function isSessionActive(session: SessionTimes, now: Date): boolean {
  return sessionInvalidReason(session, { disabledAt: null }, now) === null
}

/** True when `last_seen_at` is at least a minute old and should be written again. */
export function shouldTouch(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS
}
