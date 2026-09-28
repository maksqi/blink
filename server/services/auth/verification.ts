/**
 * Email verification (auth, `POST /api/auth/verify-email`).
 *
 * - `sendVerification(user)`: issues a `verify_email` token (24 h) and mails `/verify-email#<token>` in the background.
 * - `resendVerificationIfDue(user, now)`: at most one new mail per 10 minutes per account (decision), for sign-in
 *   attempts of unverified accounts in `domain` mode. Returns whether a mail was queued.
 * - `verifyEmail(event, token)`: single use; sets `email_verified_at` (kept if already set); audit
 *   `auth.email_verified`. Does not sign in.
 */
import { eq, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { useDb } from '../../database/client'
import { users } from '../../database/schema'
import { audit } from '../audit/audit'
import { verificationMessage } from '../mail/messages'
import { isSmtpConfigured, sendMailInBackground } from '../mail/transport'
import { evictUserFromSessionCache } from '../session/sessions'
import {
  consumeEmailToken,
  issueEmailToken,
  latestEmailTokenAt,
  VERIFICATION_RESEND_INTERVAL_MS,
  VERIFY_EMAIL_TTL_MS,
} from './email-tokens'

interface Recipient {
  id: string
  email: string
  displayName: string
}

export async function sendVerification(user: Recipient, now: Date = new Date()): Promise<void> {
  const token = await issueEmailToken(user.id, 'verify_email', { now })
  sendMailInBackground(
    verificationMessage({
      to: user.email,
      displayName: user.displayName,
      token,
      expiresInHours: VERIFY_EMAIL_TTL_MS / 3_600_000,
    }),
    'verify-email',
  )
}

export async function resendVerificationIfDue(user: Recipient, now: Date = new Date()): Promise<boolean> {
  if (!isSmtpConfigured()) return false
  const latest = await latestEmailTokenAt(user.id, 'verify_email')
  if (latest && now.getTime() - latest.getTime() < VERIFICATION_RESEND_INTERVAL_MS) return false
  await sendVerification(user, now)
  return true
}

export async function verifyEmail(event: H3Event, token: string, now: Date = new Date()): Promise<void> {
  const { userId } = await useDb().transaction(async (tx) => {
    const claimed = await consumeEmailToken(token, 'verify_email', { now, db: tx })
    await tx
      .update(users)
      .set({
        emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, ${now.toISOString()}::timestamptz)`,
        updatedAt: now,
      })
      .where(eq(users.id, claimed.userId))
    await audit(
      event,
      { action: 'auth.email_verified', actorUserId: claimed.userId, targetType: 'user', targetId: claimed.userId },
      { db: tx, now },
    )
    return claimed
  })
  evictUserFromSessionCache(userId)
}
