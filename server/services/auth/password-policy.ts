/**
 * Password policy at the API boundary (auth, docs/SECURITY.md §4). The request schemas (`passwordSchema`) already
 * enforce 12..256 characters; this adds the server-only checks and maps every failure to 400 `AUTH_PASSWORD_WEAK`
 * with `details.reason`:
 * - `too_short` / `too_long`: length rules (also enforced here for callers that skip the schema);
 * - `common`: the bundled common-password denylist (compared lowercased, plus padded and leetspeak variants,
 *   repeats, sequences and keyboard walks) from `server/utils/password.ts` (server-core);
 * - `same_as_current`: a password change must pick a new password (decision).
 *
 * (decision) The denylist is server-core's curated list with variant matching, not a separate 10k-entry file.
 */
import { apiError } from '../../utils/api-error'
import {
  checkPasswordPolicy,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type PasswordPolicyReason,
} from '../../utils/password'

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH }

export type PasswordRejection = PasswordPolicyReason | 'same_as_current'

/** Pure: why `password` is not allowed, or null. */
export function passwordRejection(password: string, options: { current?: string } = {}): PasswordRejection | null {
  const policy = checkPasswordPolicy(password)
  if (!policy.ok) return policy.reason
  if (options.current !== undefined && options.current === password) return 'same_as_current'
  return null
}

/** Throws 400 `AUTH_PASSWORD_WEAK` with `details.reason` unless `password` is allowed. */
export function assertPasswordAllowed(password: string, options: { current?: string } = {}): void {
  const reason = passwordRejection(password, options)
  if (reason) throw apiError('AUTH_PASSWORD_WEAK', 400, { reason })
}
