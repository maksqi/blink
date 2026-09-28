/**
 * The caller's own sessions (auth, docs/API.md §3).
 *
 * - `listOwnSessions(event)` → `SessionInfo[]`, most recent first, `current` marks this browser. `id` is the
 *   session's database id (sha256 of the cookie token), which cannot be turned back into the token.
 * - `revokeOwnSession(event, id)`: only the caller's own sessions (anything else, including malformed ids, is 404
 *   `NOT_FOUND`); revoking the current one also clears the cookie. Audit `auth.session_revoked`.
 * - `logout(event)`: revokes the current session and clears the cookie; audit `auth.logout`.
 */
import type { H3Event } from 'h3'
import type { SessionInfo } from '#shared/schemas/auth'
import { apiError } from '../../utils/api-error'
import { getAuth } from '../../utils/auth'
import { clearSessionCookie } from '../../utils/cookies'
import { audit } from '../audit/audit'
import { listSessions, revokeSession, type SessionRecord } from '../session/sessions'

const SESSION_ID = /^[0-9a-f]{64}$/

async function signedIn(event: H3Event) {
  const { user, session } = await getAuth(event)
  if (!user || !session) throw apiError('UNAUTHENTICATED', 401)
  return { user, session }
}

export function toSessionInfo(record: SessionRecord, currentId: string): SessionInfo {
  return {
    id: record.id,
    current: record.id === currentId,
    createdAt: record.createdAt.toISOString(),
    lastSeenAt: record.lastSeenAt.toISOString(),
    ip: record.ip,
    userAgent: record.userAgent,
  }
}

export async function listOwnSessions(event: H3Event, now: Date = new Date()): Promise<SessionInfo[]> {
  const { user, session } = await signedIn(event)
  return (await listSessions(user.id, now)).map((record) => toSessionInfo(record, session.id))
}

export async function revokeOwnSession(event: H3Event, id: string, now: Date = new Date()): Promise<void> {
  const { user, session } = await signedIn(event)
  const own = SESSION_ID.test(id) ? (await listSessions(user.id, now)).find((record) => record.id === id) : undefined
  if (!own || !(await revokeSession(own.id))) throw apiError('NOT_FOUND', 404)
  const current = own.id === session.id
  if (current) clearSessionCookie(event)
  await audit(
    event,
    {
      action: 'auth.session_revoked',
      actorUserId: user.id,
      targetType: 'session',
      targetId: own.id,
      details: { current },
    },
    { now },
  )
}

export async function logout(event: H3Event, now: Date = new Date()): Promise<void> {
  const { user, session } = await signedIn(event)
  await revokeSession(session.id)
  clearSessionCookie(event)
  await audit(event, { action: 'auth.logout', actorUserId: user.id, targetType: 'user', targetId: user.id }, { now })
}
