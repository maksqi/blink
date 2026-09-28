/**
 * Per-IP limiter for unauthenticated auth endpoints (auth, docs/API.md §1.2 `auth-ip`: 10 per minute per IP, IPv6 by
 * /64): register, verify-email, password-reset/*, invites/*. Call it first in the handler, before the body is parsed,
 * so malformed requests count too.
 */
import type { H3Event } from 'h3'
import { getClientIp, limiterKeysForIp } from '../../utils/client-ip'
import { consumeOr429 } from '../../utils/limiter'

export function limitAuthRequest(event: H3Event): void {
  consumeOr429(event, 'auth-ip', limiterKeysForIp(getClientIp(event)).net)
}
