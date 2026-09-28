/**
 * Room invite tokens (rooms-backend, docs/API.md §14): `base64url(inviteIdBytes(16) ‖ HMAC-SHA256(k_invite,
 * inviteIdBytes)[0..16])` with `k_invite = HKDF(APP_SECRET, info "blinq/v1/invite")`. Derived, never stored, verified
 * in constant time (server/utils/crypto), re-derivable for the owner.
 *
 * - `inviteTokenFor(inviteId, appSecret?)`, `inviteIdFromToken(token, appSecret?)` (null unless the MAC verifies).
 */
import { decodeRoomInviteToken, deriveRoomInviteKey, encodeRoomInviteToken } from '../../utils/crypto'
import { env } from '../../utils/env'

let cached: { secret: string; key: Buffer } | undefined

function inviteKey(appSecret: string): Buffer {
  if (cached?.secret !== appSecret) cached = { secret: appSecret, key: deriveRoomInviteKey(appSecret) }
  return cached.key
}

export function inviteTokenFor(inviteId: string, appSecret: string = env().APP_SECRET): string {
  return encodeRoomInviteToken(inviteId, inviteKey(appSecret))
}

export function inviteIdFromToken(token: string, appSecret: string = env().APP_SECRET): string | null {
  return decodeRoomInviteToken(token, inviteKey(appSecret))
}
