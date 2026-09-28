/**
 * Server-side crypto helpers (server-core). Explicit imports only, so plain Vitest can run them.
 *
 * - `randomToken(bytes = 32)`: random bytes as base64url without padding (43 chars for 32 bytes). Used for session,
 *   guest, account-invite, verify and reset tokens (docs/API.md §14).
 * - `sha256Hex(data)`: hex SHA-256 of a UTF-8 string or bytes.
 * - `hashToken(token)`: how every opaque token and the join proof are stored: `sha256Hex` of the base64url string
 *   exactly as received (`sessions.id`, `guest_sessions.id`, `*_tokens.token_hash`, `rooms.join_proof_hash`).
 * - `hmacSha256(key, data)`: raw HMAC-SHA256 digest.
 * - `hkdfSha256(ikm, info, length, salt?)`: RFC 5869 HKDF-SHA256.
 * - `safeEqual(a, b)`: constant-time comparison of strings or bytes of any length.
 * - `isOpaqueToken(value)`: shape check for 32-byte base64url tokens (43 chars).
 * - Room invite tokens (docs/API.md §14): `deriveRoomInviteKey`, `encodeRoomInviteToken`, `decodeRoomInviteToken`.
 */
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

type Bytes = string | Uint8Array

const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43}$/

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function sha256Hex(data: Bytes): string {
  return createHash('sha256').update(data).digest('hex')
}

export function hashToken(token: string): string {
  return sha256Hex(token)
}

export function hmacSha256(key: Bytes, data: Bytes): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

export function hkdfSha256(ikm: Bytes, info: Bytes, length: number, salt: Bytes = new Uint8Array(0)): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, length))
}

/**
 * Constant-time equality. Inputs are hashed first, so different lengths neither throw nor leak through an early
 * return (the length itself is not secret for tokens of a fixed format).
 */
export function safeEqual(a: Bytes, b: Bytes): boolean {
  const left = createHash('sha256').update(a).digest()
  const right = createHash('sha256').update(b).digest()
  return timingSafeEqual(left, right) && byteLength(a) === byteLength(b)
}

function byteLength(value: Bytes): number {
  return typeof value === 'string' ? Buffer.byteLength(value) : value.byteLength
}

export function isOpaqueToken(value: unknown): value is string {
  return typeof value === 'string' && OPAQUE_TOKEN.test(value)
}

// ---- Room invite tokens (derived, never stored) -------------------------------------------------------------------

const ROOM_INVITE_INFO = 'blinq/v1/invite'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `k_invite = HKDF-SHA256(ikm = UTF-8(APP_SECRET), salt = empty, info = "blinq/v1/invite", 32 bytes)`. */
export function deriveRoomInviteKey(appSecret: string): Buffer {
  return hkdfSha256(appSecret, ROOM_INVITE_INFO, 32)
}

/** `base64url(idBytes(16) ‖ HMAC-SHA256(k_invite, idBytes)[0..16])` (43 chars). */
export function encodeRoomInviteToken(inviteId: string, key: Uint8Array): string {
  if (!UUID.test(inviteId)) throw new TypeError('Room invite id must be a uuid')
  const idBytes = Buffer.from(inviteId.replace(/-/g, ''), 'hex')
  return Buffer.concat([idBytes, hmacSha256(key, idBytes).subarray(0, 16)]).toString('base64url')
}

/** The invite id when the token's MAC verifies (constant-time), otherwise null. */
export function decodeRoomInviteToken(token: string, key: Uint8Array): string | null {
  if (!isOpaqueToken(token)) return null
  const raw = Buffer.from(token, 'base64url')
  if (raw.length !== 32) return null
  const idBytes = raw.subarray(0, 16)
  if (!safeEqual(raw.subarray(16), hmacSha256(key, idBytes).subarray(0, 16))) return null
  const hex = idBytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
