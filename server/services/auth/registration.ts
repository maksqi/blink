/**
 * `POST /api/auth/register` (auth, docs/API.md §3). The mode is read from the settings service on every request, so an
 * admin's change applies to the next request (the settings cache is invalidated on write).
 *
 * - `invite_only` → 403 `REGISTRATION_CLOSED`.
 * - `open` → create (unverified), sign in, `{ kind: 'created', user }` (201). An existing email → 409 `CONFLICT`
 *   (`email_taken`): open registration cannot hide which emails exist (documented limitation, decision).
 * - `domain` → the email's domain must be in `registration.allowedDomains` (exact match, decision; 403
 *   `REGISTRATION_DOMAIN_NOT_ALLOWED`), SMTP must be configured (503 `SERVICE_UNAVAILABLE`); a new account is
 *   created unverified and gets a verification mail; an existing email gets an "account exists" mail instead. Both
 *   answer `{ kind: 'verification_required' }` (202) after the same argon2 work, and mail in the background, so
 *   neither the response nor its timing reveals the difference.
 * Audit `auth.registered`.
 */
import { isError, type H3Event } from 'h3'
import type { AuthUser } from '#shared/schemas/auth'
import type { ErrorCode } from '#shared/utils/error-codes'
import { apiError } from '../../utils/api-error'
import { hashPassword } from '../../utils/password'
import { audit } from '../audit/audit'
import { accountExistsMessage } from '../mail/messages'
import { isSmtpConfigured, sendMailInBackground } from '../mail/transport'
import { getSettings } from '../settings/settings'
import { createUser, emailDomain, findUserByEmail, toAuthUser } from '../users/users'
import { assertPasswordAllowed } from './password-policy'
import { startSession } from './sign-in'
import { sendVerification } from './verification'

export type RegisterOutcome = { kind: 'created'; user: AuthUser } | { kind: 'verification_required' }

export interface RegisterInput {
  email: string
  displayName: string
  password: string
}

function isApiErrorCode(error: unknown, code: ErrorCode): boolean {
  return isError(error) && (error.data as { code?: unknown } | undefined)?.code === code
}

/** Pure: exact, case-insensitive domain match (subdomains need their own entry). */
export function isDomainAllowed(email: string, allowedDomains: readonly string[]): boolean {
  const domain = emailDomain(email)
  return allowedDomains.some((allowed) => allowed.trim().toLowerCase() === domain)
}

export async function register(event: H3Event, input: RegisterInput, now: Date = new Date()): Promise<RegisterOutcome> {
  const settings = await getSettings()
  const mode = settings['registration.mode']
  if (mode === 'invite_only') throw apiError('REGISTRATION_CLOSED', 403)
  if (mode === 'domain') {
    if (!isDomainAllowed(input.email, settings['registration.allowedDomains'])) {
      throw apiError('REGISTRATION_DOMAIN_NOT_ALLOWED', 403)
    }
    if (!isSmtpConfigured()) throw apiError('SERVICE_UNAVAILABLE', 503)
  }
  assertPasswordAllowed(input.password)

  const passwordHash = await hashPassword(input.password)
  const accountExists = async (): Promise<RegisterOutcome | null> => {
    const existing = await findUserByEmail(input.email)
    if (!existing) return null
    sendMailInBackground(
      accountExistsMessage({ to: existing.email, displayName: existing.displayName }),
      'account-exists',
    )
    return { kind: 'verification_required' }
  }
  if (mode === 'domain') {
    const exists = await accountExists()
    if (exists) return exists
  }

  let user
  try {
    user = await createUser({ email: input.email, displayName: input.displayName, passwordHash, now })
  } catch (error) {
    // A concurrent registration of the same address won the race: in domain mode that must still look like success.
    const exists = mode === 'domain' && isApiErrorCode(error, 'CONFLICT') ? await accountExists() : null
    if (exists) return exists
    throw error
  }
  await audit(
    event,
    { action: 'auth.registered', actorUserId: user.id, targetType: 'user', targetId: user.id, details: { mode } },
    { now },
  )
  if (mode === 'domain') {
    await sendVerification(user, now)
    return { kind: 'verification_required' }
  }
  await startSession(event, user.id, 'password', now)
  return { kind: 'created', user: toAuthUser(user) }
}
