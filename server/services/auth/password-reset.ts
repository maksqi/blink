/**
 * Password reset by email (auth, docs/API.md §3).
 *
 * - `requestPasswordReset(email)`: SMTP off → 503 `SERVICE_UNAVAILABLE`. Otherwise the caller always answers 202: the
 *   `reset-email` limiter (3 per hour per address) drops extra requests silently, and only an existing, enabled
 *   account gets a mail with `/reset-password#<token>` (1 h, single use; a new request replaces older links). The mail
 *   is sent in the background, so the response time does not depend on the account. Audit
 *   `auth.password_reset_requested` when a mail is queued.
 * - `confirmPasswordReset(event, { token, newPassword })`: the policy is checked before the token is spent; then the
 *   token is consumed and the password set in one transaction (`must_change_password = false`; a working reset link
 *   also proves the address, so it counts as verified). Every session is revoked (`user.revoked`), the email's login
 *   backoff is cleared, audit `auth.password_reset`. It does not sign in (decision).
 */
import type { H3Event } from 'h3'
import { useDb } from '../../database/client'
import { apiError } from '../../utils/api-error'
import { clearLoginFailures, emailThrottleKey, getLimiter } from '../../utils/limiter'
import { audit } from '../audit/audit'
import { passwordResetMessage } from '../mail/messages'
import { isSmtpConfigured, sendMailInBackground } from '../mail/transport'
import { revokeAllForUser } from '../session/sessions'
import { findUserByEmail, setPassword } from '../users/users'
import { consumeEmailToken, issueEmailToken, RESET_PASSWORD_TTL_MS } from './email-tokens'
import { assertPasswordAllowed } from './password-policy'

export async function requestPasswordReset(event: H3Event, email: string, now: Date = new Date()): Promise<void> {
  if (!isSmtpConfigured()) throw apiError('SERVICE_UNAVAILABLE', 503)
  if (!getLimiter('reset-email').consume(emailThrottleKey(email)).allowed) return
  const user = await findUserByEmail(email)
  if (!user || user.disabledAt) return
  const token = await issueEmailToken(user.id, 'reset_password', { now, replace: true })
  sendMailInBackground(
    passwordResetMessage({
      to: user.email,
      displayName: user.displayName,
      token,
      expiresInMinutes: RESET_PASSWORD_TTL_MS / 60_000,
    }),
    'reset-password',
  )
  await audit(
    event,
    { action: 'auth.password_reset_requested', actorUserId: null, targetType: 'user', targetId: user.id },
    { now },
  )
}

export async function confirmPasswordReset(
  event: H3Event,
  input: { token: string; newPassword: string },
  now: Date = new Date(),
): Promise<void> {
  assertPasswordAllowed(input.newPassword)
  const user = await useDb().transaction(async (tx) => {
    const { userId } = await consumeEmailToken(input.token, 'reset_password', { now, db: tx })
    const row = await setPassword(userId, input.newPassword, {
      mustChangePassword: false,
      markEmailVerified: true,
      now,
      db: tx,
    })
    await audit(
      event,
      { action: 'auth.password_reset', actorUserId: userId, targetType: 'user', targetId: userId },
      { db: tx, now },
    )
    return row
  })
  await revokeAllForUser(user.id)
  await clearLoginFailures([emailThrottleKey(user.email)])
}
