/**
 * Pure invite rules (rooms-backend).
 *
 * - `inviteExpiresAt(expiresIn, now)`: `1h`, `24h`, `7d` or `never` (null).
 * - `inviteState(invite, now)`: `revoked` → `expired` → `exhausted` (use_count reached max_uses) → `valid`.
 * - `inviteUsableForInfo(state)`: `POST /api/join/:slug/info` accepts a genuine, unrevoked, unexpired invite even when
 *   it has no uses left, because the join itself decides (a resuming participant already consumed their use)
 *   (decision).
 */
import type { z } from 'zod'
import type { inviteExpirySchema } from '#shared/schemas/rooms'

export type InviteExpiry = z.infer<typeof inviteExpirySchema>
export type InviteState = 'valid' | 'revoked' | 'expired' | 'exhausted'

const HOUR = 3_600_000
const DURATIONS: Record<Exclude<InviteExpiry, 'never'>, number> = { '1h': HOUR, '24h': 24 * HOUR, '7d': 7 * 24 * HOUR }

export function inviteExpiresAt(expiresIn: InviteExpiry, now: Date): Date | null {
  return expiresIn === 'never' ? null : new Date(now.getTime() + DURATIONS[expiresIn])
}

export interface InviteLimits {
  revokedAt: Date | null
  expiresAt: Date | null
  maxUses: number | null
  useCount: number
}

export function inviteState(invite: InviteLimits, now: Date): InviteState {
  if (invite.revokedAt) return 'revoked'
  if (invite.expiresAt && invite.expiresAt.getTime() <= now.getTime()) return 'expired'
  if (invite.maxUses !== null && invite.useCount >= invite.maxUses) return 'exhausted'
  return 'valid'
}

export function inviteUsableForInfo(state: InviteState | null): boolean {
  return state === 'valid' || state === 'exhausted'
}
