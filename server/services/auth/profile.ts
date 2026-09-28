/**
 * `PATCH /api/me` (auth, docs/API.md §4): the signed-in user's display name (already normalized by
 * `displayNameSchema`). The session cache is evicted so the next request sees the new name. Audit
 * `user.profile_updated` (only when something changed).
 */
import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { AuthUser } from '#shared/schemas/auth'
import { useDb } from '../../database/client'
import { users } from '../../database/schema'
import { apiError } from '../../utils/api-error'
import { getAuth } from '../../utils/auth'
import { audit } from '../audit/audit'
import { evictUserFromSessionCache } from '../session/sessions'
import { findUserById, toAuthUser } from '../users/users'

export async function updateProfile(
  event: H3Event,
  input: { displayName: string },
  now: Date = new Date(),
): Promise<AuthUser> {
  const { user } = await getAuth(event)
  if (!user) throw apiError('UNAUTHENTICATED', 401)
  if (input.displayName === user.displayName) {
    const current = await findUserById(user.id)
    if (current) return toAuthUser(current)
  }
  const [row] = await useDb()
    .update(users)
    .set({ displayName: input.displayName, updatedAt: now })
    .where(eq(users.id, user.id))
    .returning()
  if (!row) throw apiError('UNAUTHENTICATED', 401)
  evictUserFromSessionCache(user.id)
  await audit(
    event,
    {
      action: 'user.profile_updated',
      actorUserId: user.id,
      targetType: 'user',
      targetId: user.id,
      details: { fields: ['displayName'] },
    },
    { now },
  )
  return toAuthUser(row)
}
