/**
 * `POST /api/auth/login` (auth, docs/API.md §3).
 *
 * 1. The `login` backoff for `email:<address>` and `ip:<v4>` / `net:<v6 /64>` is checked first (429 `RATE_LIMITED`
 *    with `Retry-After`).
 * 2. The `password` provider verifies the credentials. Unknown emails pay the argon2 cost and get exactly the same
 *    401 `AUTH_INVALID_CREDENTIALS` as a wrong password; both count as failures for every key.
 * 3. Only after a correct password are disabled and unverified states revealed (`completeSignIn`).
 * 4. Success clears the email's backoff (not the IP's).
 */
import type { H3Event } from 'h3'
import type { AuthUser } from '#shared/schemas/auth'
import { apiError } from '../../utils/api-error'
import { getClientIp } from '../../utils/client-ip'
import { passwordProvider } from './providers'
import { auditLoginFailure, completeSignIn } from './sign-in'
import { loginThrottle, loginThrottleKeys } from './throttle'

export async function loginWithPassword(event: H3Event, input: { email: string; password: string }): Promise<AuthUser> {
  const email = input.email.trim().toLowerCase()
  const keys = loginThrottleKeys(email, getClientIp(event))
  await loginThrottle.assertAllowed(event, keys)

  const result = await passwordProvider.authenticate({ email, password: input.password })
  if (!result) {
    await loginThrottle.recordFailure(keys)
    await auditLoginFailure(event, { email, reason: 'invalid_credentials', method: 'password' })
    throw apiError('AUTH_INVALID_CREDENTIALS', 401)
  }

  const user = await completeSignIn(event, { userId: result.userId, method: 'password' })
  await loginThrottle.recordSuccess(email)
  return user
}
