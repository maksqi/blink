/**
 * The one sign-in path every provider goes through (auth, docs/API.md §3).
 *
 * - `signInWithProvider(event, providerId, input)`: provider → `completeSignIn`; 401 `AUTH_INVALID_CREDENTIALS` when
 *   the provider does not identify an account.
 * - `completeSignIn(event, { userId, method })`, only after the credentials were verified:
 *   disabled → 403 `AUTH_ACCOUNT_DISABLED`; unverified while `registration.mode = 'domain'` (read live) → 403
 *   `AUTH_EMAIL_NOT_VERIFIED` plus at most one new verification mail per 10 minutes; otherwise a new session
 *   (`sessions.auth_method` = provider id) replaces any session the browser had, the cookie is set,
 *   `last_login_at` updated and `auth.login` audited. Refusals are audited as `auth.login_failed`.
 * - `startSession(event, userId, method)`: session + cookie + `last_login_at` only (invite acceptance, open
 *   registration), for accounts that were just created.
 */
import { eq } from 'drizzle-orm'
import { getRequestHeader, type H3Event } from 'h3'
import type { AuthUser } from '#shared/schemas/auth'
import { useDb } from '../../database/client'
import { users } from '../../database/schema'
import { apiError } from '../../utils/api-error'
import { getAuth } from '../../utils/auth'
import { getClientIp } from '../../utils/client-ip'
import { setSessionCookie } from '../../utils/cookies'
import { audit } from '../audit/audit'
import { createSession, revokeSession } from '../session/sessions'
import { getSettings } from '../settings/settings'
import { findUserById, toAuthUser } from '../users/users'
import { requireAuthProvider, type AuthProviderId } from './providers'
import { resendVerificationIfDue } from './verification'

export async function startSession(
  event: H3Event,
  userId: string,
  method: AuthProviderId,
  now: Date = new Date(),
): Promise<void> {
  // Rotation: whatever session this browser held (another account, or a fixated cookie) ends here.
  const { session } = await getAuth(event)
  if (session) await revokeSession(session.id)
  const token = await createSession(
    userId,
    { ip: getClientIp(event), userAgent: getRequestHeader(event, 'user-agent') ?? null, authMethod: method },
    now,
  )
  setSessionCookie(event, token)
  await useDb().update(users).set({ lastLoginAt: now }).where(eq(users.id, userId))
}

export async function auditLoginFailure(
  event: H3Event,
  details: { email?: string; reason: string; method: AuthProviderId },
  targetUserId: string | null = null,
): Promise<void> {
  await audit(event, {
    action: 'auth.login_failed',
    actorUserId: null,
    targetType: targetUserId ? 'user' : null,
    targetId: targetUserId,
    details,
  })
}

export async function completeSignIn(
  event: H3Event,
  input: { userId: string; method: AuthProviderId },
  now: Date = new Date(),
): Promise<AuthUser> {
  const user = await findUserById(input.userId)
  if (!user) throw apiError('AUTH_INVALID_CREDENTIALS', 401)
  if (user.disabledAt) {
    await auditLoginFailure(event, { email: user.email, reason: 'disabled', method: input.method }, user.id)
    throw apiError('AUTH_ACCOUNT_DISABLED', 403)
  }
  if (!user.emailVerifiedAt && (await getSettings())['registration.mode'] === 'domain') {
    await resendVerificationIfDue(user, now)
    await auditLoginFailure(event, { email: user.email, reason: 'email_not_verified', method: input.method }, user.id)
    throw apiError('AUTH_EMAIL_NOT_VERIFIED', 403)
  }

  await startSession(event, user.id, input.method, now)
  await audit(
    event,
    {
      action: 'auth.login',
      actorUserId: user.id,
      targetType: 'user',
      targetId: user.id,
      details: { method: input.method },
    },
    { now },
  )
  return toAuthUser(user)
}

export async function signInWithProvider(event: H3Event, providerId: string, input: unknown): Promise<AuthUser> {
  const provider = requireAuthProvider(providerId)
  const result = await provider.authenticate(input)
  if (!result) {
    await auditLoginFailure(event, { reason: 'invalid_credentials', method: provider.id })
    throw apiError('AUTH_INVALID_CREDENTIALS', 401)
  }
  return completeSignIn(event, { userId: result.userId, method: provider.id })
}
