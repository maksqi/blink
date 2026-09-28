/**
 * Account invites, user side (auth, docs/API.md §3). Invites work in every registration mode and bypass the domain
 * list.
 *
 * - `previewInvite(token)` → `InvitePreview`; 400 `INVITE_INVALID` (unknown or revoked), 410 `INVITE_EXPIRED`,
 *   410 `INVITE_USED`.
 * - `acceptInvite(event, { token, email?, displayName, password })` → `AuthUser`, signed in (201):
 *   - a bound invite (always the case for `role = 'admin'`) takes its email; a different `email` → 400
 *     `INVITE_INVALID`; the bound address counts as verified (decision);
 *   - an unbound invite needs `email` (400 `VALIDATION_FAILED`, path `email`); that address is unverified;
 *   - an email that already has an account → 409 `CONFLICT` (`email_taken`);
 *   - single use: the atomic claim (`claimInvite`) runs in the user-creation transaction, so of concurrent accepts
 *     exactly one succeeds and the others get 410 `INVITE_USED`.
 *   Audit `auth.invite_accepted`.
 */
import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { AuthUser, InvitePreview } from '#shared/schemas/auth'
import { useDb } from '../../database/client'
import { userInvites } from '../../database/schema'
import { apiError } from '../../utils/api-error'
import { hashPassword } from '../../utils/password'
import { audit } from '../audit/audit'
import { claimInvite, findInviteByToken, inviteState, inviteStateError, type InviteRow } from '../users/invites'
import { createUser, emailTaken, findUserByEmail, normalizeEmail, toAuthUser } from '../users/users'
import { assertPasswordAllowed } from './password-policy'
import { startSession } from './sign-in'

async function usableInvite(token: string, now: Date): Promise<InviteRow> {
  const invite = await findInviteByToken(token)
  if (!invite) throw inviteStateError('unknown')
  const state = inviteState(invite, now)
  if (state !== 'valid') throw inviteStateError(state)
  return invite
}

export async function previewInvite(token: string, now: Date = new Date()): Promise<InvitePreview> {
  const invite = await usableInvite(token, now)
  return { email: invite.email, role: invite.role, expiresAt: invite.expiresAt.toISOString() }
}

/** Pure: the address the new account gets. */
export function inviteEmail(invite: Pick<InviteRow, 'email'>, requested: string | undefined): string {
  if (invite.email) {
    if (requested !== undefined && normalizeEmail(requested) !== invite.email) throw apiError('INVITE_INVALID', 400)
    return invite.email
  }
  if (requested === undefined) {
    throw apiError('VALIDATION_FAILED', 400, { issues: [{ path: 'email', message: 'Enter your email address' }] })
  }
  return normalizeEmail(requested)
}

export async function acceptInvite(
  event: H3Event,
  input: { token: string; email?: string; displayName: string; password: string },
  now: Date = new Date(),
): Promise<AuthUser> {
  const invite = await usableInvite(input.token, now)
  const email = inviteEmail(invite, input.email)
  assertPasswordAllowed(input.password)
  if (await findUserByEmail(email)) throw emailTaken()
  const passwordHash = await hashPassword(input.password)

  const user = await useDb().transaction(async (tx) => {
    const claimed = await claimInvite(tx, invite.id, now)
    if (!claimed) {
      const [current] = await tx.select().from(userInvites).where(eq(userInvites.id, invite.id))
      const state = current ? inviteState(current, now) : 'revoked'
      throw inviteStateError(state === 'valid' ? 'used' : state)
    }
    const created = await createUser(
      {
        email,
        displayName: input.displayName,
        role: claimed.role,
        passwordHash,
        emailVerified: claimed.email !== null,
        now,
      },
      tx,
    )
    await tx.update(userInvites).set({ usedBy: created.id }).where(eq(userInvites.id, claimed.id))
    await audit(
      event,
      {
        action: 'auth.invite_accepted',
        actorUserId: created.id,
        targetType: 'invite',
        targetId: claimed.id,
        details: { role: claimed.role, bound: claimed.email !== null },
      },
      { db: tx, now },
    )
    return created
  })

  await startSession(event, user.id, 'password', now)
  return toAuthUser(user)
}
