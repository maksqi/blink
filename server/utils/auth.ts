/**
 * Request authentication and caller resolution (server-core, docs/API.md §1.1).
 *
 * - `getAuth(event)` → `{ user, session }` from the session cookie, resolved once per request. An invalid or expired
 *   cookie is cleared and the request is anonymous.
 * - `requireUser(event)` → `AuthUser`, else 401 `UNAUTHENTICATED`.
 * - `requireAdmin(event)` → admin `AuthUser`, else 401 (anonymous) or 403 `FORBIDDEN`.
 * - `getGuestSession(event, roomId)` → the unexpired guest session behind the room's guest cookie, or null.
 * - `resolveCaller(event, roomId, { clientId? })` → the caller's own active `call_participants` row in the room's
 *   live meeting (user session first, then the room's guest cookie), else 403 `CALL_NOT_PARTICIPANT`. Check the
 *   action afterwards with `canPerform` (403 `CALL_FORBIDDEN`).
 * The forced password change is enforced by middleware, not here (exempt routes still need `requireUser`).
 */
import type { H3Event } from 'h3'
import type { AuthUser } from '#shared/schemas/auth'
import {
  findActiveParticipant,
  findGuestSession,
  roomSlugForId,
  type CallParticipant,
} from '../services/session/callers'
import { validateSession, type SessionRecord } from '../services/session/sessions'
import { apiError } from './api-error'
import { clearSessionCookie, readGuestToken, readSessionToken } from './cookies'

export interface AuthContext {
  user: AuthUser | null
  session: SessionRecord | null
}

declare module 'h3' {
  interface H3EventContext {
    /** Use `getAuth(event)`; this holds its per-request promise. */
    blinqAuth?: Promise<AuthContext>
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function getAuth(event: H3Event): Promise<AuthContext> {
  event.context.blinqAuth ??= resolveAuth(event)
  return event.context.blinqAuth
}

async function resolveAuth(event: H3Event): Promise<AuthContext> {
  const token = readSessionToken(event)
  if (!token) return { user: null, session: null }
  const valid = await validateSession(token)
  if (!valid) {
    clearSessionCookie(event)
    return { user: null, session: null }
  }
  return { user: valid.user, session: valid.session }
}

export async function requireUser(event: H3Event): Promise<AuthUser> {
  const { user } = await getAuth(event)
  if (!user) throw apiError('UNAUTHENTICATED', 401)
  return user
}

export async function requireAdmin(event: H3Event): Promise<AuthUser> {
  const user = await requireUser(event)
  if (user.role !== 'admin') throw apiError('FORBIDDEN', 403)
  return user
}

export async function getGuestSession(event: H3Event, roomId: string) {
  if (!UUID.test(roomId)) return null
  const slug = await roomSlugForId(roomId)
  const token = slug ? readGuestToken(event, slug) : null
  return token ? findGuestSession(token, roomId) : null
}

export async function resolveCaller(
  event: H3Event,
  roomId: string,
  options: { clientId?: string } = {},
): Promise<CallParticipant> {
  if (!UUID.test(roomId)) throw apiError('CALL_NOT_PARTICIPANT', 403)
  const { user } = await getAuth(event)
  if (user) {
    const row = await findActiveParticipant(roomId, { userId: user.id }, options.clientId)
    if (row) return row
  }
  const guest = await getGuestSession(event, roomId)
  if (guest) {
    const row = await findActiveParticipant(roomId, { guestSessionId: guest.id }, options.clientId)
    if (row) return row
  }
  throw apiError('CALL_NOT_PARTICIPANT', 403)
}
