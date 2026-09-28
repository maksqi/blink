/**
 * Email verification and password-reset tokens (auth, table `email_tokens`): 32 random bytes, base64url, only the
 * sha256 is stored; single use; verify 24 h, reset 1 h (decision).
 *
 * - `issueEmailToken(userId, purpose, { now, replace, db })` → raw token. `replace` drops the user's unused tokens of
 *   the same purpose first, so only the newest link works (decision, used for resets).
 * - `consumeEmailToken(token, purpose, { now, db })` → `{ userId }`: atomic `UPDATE … WHERE used_at IS NULL AND
 *   expires_at > now RETURNING`; otherwise 400 `AUTH_TOKEN_EXPIRED` (known, unused, expired) or `AUTH_TOKEN_INVALID`
 *   (unknown, used, other purpose).
 * - `latestEmailTokenAt(userId, purpose)`: when the newest token was issued (resend throttling).
 * - `emailTokenState(row, now)`: pure.
 */
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import { useDb, type Db, type Tx } from '../../database/client'
import { emailTokens } from '../../database/schema'
import { apiError } from '../../utils/api-error'
import { hashToken, isOpaqueToken, randomToken } from '../../utils/crypto'

export type EmailTokenPurpose = 'verify_email' | 'reset_password'

export const VERIFY_EMAIL_TTL_MS = 24 * 3_600_000
export const RESET_PASSWORD_TTL_MS = 3_600_000
/** A new verification mail at most every 10 minutes per account (decision). */
export const VERIFICATION_RESEND_INTERVAL_MS = 10 * 60_000

export const EMAIL_TOKEN_TTL_MS: Record<EmailTokenPurpose, number> = {
  verify_email: VERIFY_EMAIL_TTL_MS,
  reset_password: RESET_PASSWORD_TTL_MS,
}

type EmailTokenRow = typeof emailTokens.$inferSelect

export type EmailTokenState = 'valid' | 'used' | 'expired'

export function emailTokenState(row: Pick<EmailTokenRow, 'usedAt' | 'expiresAt'>, now: Date): EmailTokenState {
  if (row.usedAt) return 'used'
  return row.expiresAt.getTime() <= now.getTime() ? 'expired' : 'valid'
}

export async function issueEmailToken(
  userId: string,
  purpose: EmailTokenPurpose,
  options: { now?: Date; replace?: boolean; db?: Db | Tx } = {},
): Promise<string> {
  const db = options.db ?? useDb()
  const now = options.now ?? new Date()
  if (options.replace) {
    await db
      .delete(emailTokens)
      .where(and(eq(emailTokens.userId, userId), eq(emailTokens.purpose, purpose), isNull(emailTokens.usedAt)))
  }
  const token = randomToken()
  await db.insert(emailTokens).values({
    userId,
    purpose,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + EMAIL_TOKEN_TTL_MS[purpose]),
    createdAt: now,
  })
  return token
}

export async function consumeEmailToken(
  token: string,
  purpose: EmailTokenPurpose,
  options: { now?: Date; db?: Db | Tx } = {},
): Promise<{ userId: string }> {
  if (!isOpaqueToken(token)) throw apiError('AUTH_TOKEN_INVALID', 400)
  const db = options.db ?? useDb()
  const now = options.now ?? new Date()
  const tokenHash = hashToken(token)
  const [claimed] = await db
    .update(emailTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(emailTokens.tokenHash, tokenHash),
        eq(emailTokens.purpose, purpose),
        isNull(emailTokens.usedAt),
        gt(emailTokens.expiresAt, now),
      ),
    )
    .returning({ userId: emailTokens.userId })
  if (claimed) return claimed

  const [row] = await db
    .select({ usedAt: emailTokens.usedAt, expiresAt: emailTokens.expiresAt })
    .from(emailTokens)
    .where(and(eq(emailTokens.tokenHash, tokenHash), eq(emailTokens.purpose, purpose)))
    .limit(1)
  if (row && emailTokenState(row, now) === 'expired') throw apiError('AUTH_TOKEN_EXPIRED', 400)
  throw apiError('AUTH_TOKEN_INVALID', 400)
}

export async function latestEmailTokenAt(userId: string, purpose: EmailTokenPurpose): Promise<Date | null> {
  const [row] = await useDb()
    .select({ createdAt: emailTokens.createdAt })
    .from(emailTokens)
    .where(and(eq(emailTokens.userId, userId), eq(emailTokens.purpose, purpose)))
    .orderBy(desc(emailTokens.createdAt))
    .limit(1)
  return row?.createdAt ?? null
}
