/**
 * The `password` provider (auth, docs/SECURITY.md §4): email + password against `users.password_hash`.
 * - Unknown emails and accounts without a password (external sign-in only) pay the same argon2 cost through the same
 *   semaphore (`verifyAgainstDummy`), so response times do not reveal which accounts exist.
 * - A hash made with other argon2 parameters is upgraded after a successful verify.
 * - The `password` identity (`auth_identities`, subject = user id) is created if missing and its `last_used_at`
 *   updated, so identities stay complete for accounts created before identities existed (or by test factories).
 */
import { eq } from 'drizzle-orm'
import { useDb } from '../../../database/client'
import { authIdentities, users } from '../../../database/schema'
import { logger } from '../../../utils/logger'
import { hashPassword, passwordNeedsRehash, verifyAgainstDummy, verifyPassword } from '../../../utils/password'
import type { AuthProvider, PasswordCredentials } from './types'

export async function touchPasswordIdentity(userId: string, email: string, now: Date = new Date()): Promise<void> {
  await useDb()
    .insert(authIdentities)
    .values({ userId, provider: 'password', subject: userId, email, lastUsedAt: now })
    .onConflictDoUpdate({
      target: [authIdentities.provider, authIdentities.subject],
      set: { lastUsedAt: now, email },
    })
}

export const passwordProvider: AuthProvider<PasswordCredentials> = {
  id: 'password',
  async authenticate({ email, password }) {
    const address = email.trim().toLowerCase()
    const [row] = await useDb()
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, address))
      .limit(1)
    if (!row?.passwordHash) {
      await verifyAgainstDummy(password)
      return null
    }
    if (!(await verifyPassword(row.passwordHash, password))) return null

    if (passwordNeedsRehash(row.passwordHash)) {
      try {
        await useDb()
          .update(users)
          .set({ passwordHash: await hashPassword(password) })
          .where(eq(users.id, row.id))
      } catch (error) {
        logger.warn('password rehash failed', { err: error })
      }
    }
    await touchPasswordIdentity(row.id, address)
    return { userId: row.id }
  },
}
