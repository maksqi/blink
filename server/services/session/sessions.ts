/**
 * Server-side sessions (server-core). The raw token (32 random bytes, base64url) lives only in the cookie;
 * `sessions.id` is `hashToken(token)`.
 *
 * - `createSession(userId, meta)` → raw token. Set it with `setSessionCookie(event, token)`.
 * - `validateSession(token)` → `{ session, user }` or null (absolute 30 d, idle 7 d, disabled users rejected).
 *   Cached ≤ 30 s; `last_seen_at` is written at most once a minute.
 * - `rotateSession(sessionId, meta?)` → new raw token for the same user (login, privilege change), or null.
 * - `revokeSession(sessionId)`, `revokeAllForUser(userId, { exceptSessionId? })` (publishes `user.revoked` when
 *   every session goes), `listSessions(userId)` (active sessions, most recent first).
 * - `evictUserFromSessionCache(userId)`: call after changing a user's role, name or flags so requests see it at once.
 * - `watchUserRevocations()`: evicts cached sessions on `user.revoked` bus events (a startup plugin calls it).
 */
import { and, desc, eq, gt, lt, ne } from 'drizzle-orm'
import type { AuthUser } from '#shared/schemas/auth'
import { useDb } from '../../database/client'
import { sessions, users } from '../../database/schema'
import { hashToken, isOpaqueToken, randomToken } from '../../utils/crypto'
import { eventBus, subscribeTo } from '../../utils/event-bus'
import { createSessionCache } from './cache'
import {
  SESSION_CACHE_TTL_MS,
  SESSION_IDLE_TTL_MS,
  SESSION_TOUCH_INTERVAL_MS,
  sessionExpiresAt,
  sessionInvalidReason,
  shouldTouch,
} from './policy'

export interface SessionMeta {
  ip?: string | null
  userAgent?: string | null
  /** `password` today; `oidc:<provider>` later. */
  authMethod?: string
}

export interface SessionRecord {
  id: string
  userId: string
  authMethod: string
  createdAt: Date
  lastSeenAt: Date
  expiresAt: Date
  ip: string | null
  userAgent: string | null
}

export interface ValidSession {
  session: SessionRecord
  user: AuthUser
}

interface CachedEntry extends ValidSession {
  disabledAt: Date | null
}

const cache = createSessionCache<CachedEntry>({ ttlMs: SESSION_CACHE_TTL_MS })

const USER_AGENT_MAX = 512

export async function createSession(userId: string, meta: SessionMeta = {}, now: Date = new Date()): Promise<string> {
  const token = randomToken()
  await useDb()
    .insert(sessions)
    .values({
      id: hashToken(token),
      userId,
      authMethod: meta.authMethod ?? 'password',
      createdAt: now,
      lastSeenAt: now,
      expiresAt: sessionExpiresAt(now),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ? meta.userAgent.slice(0, USER_AGENT_MAX) : null,
    })
  return token
}

export async function validateSession(token: string, options: { now?: Date } = {}): Promise<ValidSession | null> {
  if (!isOpaqueToken(token)) return null
  const now = options.now ?? new Date()
  const id = hashToken(token)

  let entry = cache.get(id, now)
  if (!entry) {
    const loaded = await loadSession(id)
    if (!loaded) return null
    entry = loaded
    cache.set(id, entry, now)
  }

  const reason = sessionInvalidReason(entry.session, entry, now)
  if (reason) {
    cache.delete(id)
    // Expired rows are useless; disabled users keep theirs until an admin revokes them.
    if (reason !== 'disabled') await useDb().delete(sessions).where(eq(sessions.id, id))
    return null
  }

  if (shouldTouch(entry.session.lastSeenAt, now)) {
    // Conditional write: concurrent requests (or processes) touch the row at most once a minute.
    await useDb()
      .update(sessions)
      .set({ lastSeenAt: now })
      .where(and(eq(sessions.id, id), lt(sessions.lastSeenAt, new Date(now.getTime() - SESSION_TOUCH_INTERVAL_MS))))
    entry = { ...entry, session: { ...entry.session, lastSeenAt: now } }
    cache.update(id, entry)
  }

  return { session: entry.session, user: entry.user }
}

async function loadSession(id: string): Promise<CachedEntry | null> {
  const [row] = await useDb()
    .select({
      session: sessions,
      user: {
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        mustChangePassword: users.mustChangePassword,
        emailVerifiedAt: users.emailVerifiedAt,
        disabledAt: users.disabledAt,
      },
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1)
  if (!row) return null
  const { emailVerifiedAt, disabledAt, ...user } = row.user
  return { session: row.session, user: { ...user, emailVerified: emailVerifiedAt !== null }, disabledAt }
}

export async function rotateSession(sessionId: string, meta: SessionMeta = {}, now: Date = new Date()): Promise<string | null> {
  const [old] = await useDb().delete(sessions).where(eq(sessions.id, sessionId)).returning()
  cache.delete(sessionId)
  if (!old) return null
  return createSession(
    old.userId,
    { ip: meta.ip ?? old.ip, userAgent: meta.userAgent ?? old.userAgent, authMethod: meta.authMethod ?? old.authMethod },
    now,
  )
}

export async function revokeSession(sessionId: string): Promise<boolean> {
  cache.delete(sessionId)
  const deleted = await useDb().delete(sessions).where(eq(sessions.id, sessionId)).returning({ id: sessions.id })
  return deleted.length > 0
}

export async function revokeAllForUser(userId: string, options: { exceptSessionId?: string } = {}): Promise<number> {
  const condition = options.exceptSessionId
    ? and(eq(sessions.userId, userId), ne(sessions.id, options.exceptSessionId))
    : eq(sessions.userId, userId)
  const deleted = await useDb().delete(sessions).where(condition).returning({ id: sessions.id })
  for (const row of deleted) cache.delete(row.id)
  if (!options.exceptSessionId) {
    cache.deleteUser(userId)
    eventBus().publish({ type: 'user.revoked', userId })
  }
  return deleted.length
}

export async function listSessions(userId: string, now: Date = new Date()): Promise<SessionRecord[]> {
  return useDb()
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        gt(sessions.expiresAt, now),
        gt(sessions.lastSeenAt, new Date(now.getTime() - SESSION_IDLE_TTL_MS)),
      ),
    )
    .orderBy(desc(sessions.lastSeenAt))
}

export function evictUserFromSessionCache(userId: string): void {
  cache.deleteUser(userId)
}

export function watchUserRevocations(): () => void {
  return subscribeTo('user.revoked', (event) => cache.deleteUser(event.userId))
}
