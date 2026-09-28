/**
 * Account invites (auth; consumed by the Stage 03 admin handlers and by `/api/auth/invites/*`).
 *
 * Admin side (each writes its audit entry; handlers must not add another):
 * - `createAccountInvite(input, actor)` → `CreatedInvite` with the raw token (shown once; the DB keeps only its
 *   sha256). `input` is `adminCreateInviteSchema` output and is re-validated: admin-role invites need an email and
 *   expire within 24 h (400 `VALIDATION_FAILED`). `sendEmail` needs an email and SMTP (503 `SERVICE_UNAVAILABLE`,
 *   `details.smtpError` on delivery failure, nothing is created then). An email that already has an account →
 *   409 `CONFLICT` (`email_taken`). Audit `admin.invite_created`.
 * - `listAccountInvites({ page, pageSize, q })` → `Paginated<AdminInvite>`, newest first, `q` matches the email.
 * - `revokeAccountInvite(id, actor)` → `AdminInvite`; 404 `NOT_FOUND`; idempotent. Audit `admin.invite_revoked`.
 *
 * Shared helpers: `inviteState(row, now)`, `inviteStateError(state)`, `findInviteByToken(token)`,
 * `claimInvite(tx, id, now)` (the atomic single-use claim), `toAdminInvite(row)`, `inviteLink(token)`.
 */
import { and, count, desc, eq, gt, ilike, isNull, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import { adminCreateInviteSchema, type AdminInvite, type CreatedInvite } from '#shared/schemas/admin'
import type { Paginated } from '#shared/schemas/common'
import { useDb, type Tx } from '../../database/client'
import { userInvites } from '../../database/schema'
import { apiError } from '../../utils/api-error'
import { hashToken, isOpaqueToken, randomToken } from '../../utils/crypto'
import { toValidationIssues } from '../../utils/validation'
import { audit } from '../audit/audit'
import { accountInviteLink } from '../mail/links'
import { accountInviteMessage } from '../mail/messages'
import { isSmtpConfigured, sendMailOr503 } from '../mail/transport'
import { assertAdmin, type AdminActor } from './actor'
import { emailTaken, findUserByEmail } from './users'

export type InviteRow = typeof userInvites.$inferSelect
export type AdminCreateInviteInput = z.input<typeof adminCreateInviteSchema>

const HOUR = 3_600_000
export const INVITE_TTL_MS = { '24h': 24 * HOUR, '7d': 7 * 24 * HOUR, '30d': 30 * 24 * HOUR } as const

export type InviteState = 'valid' | 'revoked' | 'used' | 'expired'

/** Pure. Revoked wins over used, used over expired. */
export function inviteState(row: Pick<InviteRow, 'revokedAt' | 'usedAt' | 'expiresAt'>, now: Date): InviteState {
  if (row.revokedAt) return 'revoked'
  if (row.usedAt) return 'used'
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired'
  return 'valid'
}

/** Unknown and revoked invites look the same (400 `INVITE_INVALID`); used and expired are 410. */
export function inviteStateError(state: Exclude<InviteState, 'valid'> | 'unknown') {
  if (state === 'used') return apiError('INVITE_USED', 410)
  if (state === 'expired') return apiError('INVITE_EXPIRED', 410)
  return apiError('INVITE_INVALID', 400)
}

export function toAdminInvite(row: InviteRow): AdminInvite {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt.toISOString(),
    usedAt: row.usedAt?.toISOString() ?? null,
    revoked: row.revokedAt !== null,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  }
}

export const inviteLink = accountInviteLink

export async function findInviteByToken(token: string): Promise<InviteRow | undefined> {
  if (!isOpaqueToken(token)) return undefined
  const [row] = await useDb()
    .select()
    .from(userInvites)
    .where(eq(userInvites.tokenHash, hashToken(token)))
    .limit(1)
  return row
}

/**
 * Single use under concurrency: only one transaction can move `used_at` from null. Others block on the row lock
 * until the winner commits, then match nothing. Returns the claimed row or undefined.
 */
export async function claimInvite(tx: Tx, inviteId: string, now: Date): Promise<InviteRow | undefined> {
  const [row] = await tx
    .update(userInvites)
    .set({ usedAt: now })
    .where(
      and(
        eq(userInvites.id, inviteId),
        isNull(userInvites.usedAt),
        isNull(userInvites.revokedAt),
        gt(userInvites.expiresAt, now),
      ),
    )
    .returning()
  return row
}

export async function createAccountInvite(input: AdminCreateInviteInput, actor: AdminActor): Promise<CreatedInvite> {
  const now = assertAdmin(actor)
  const parsed = adminCreateInviteSchema.safeParse(input)
  if (!parsed.success) throw apiError('VALIDATION_FAILED', 400, { issues: toValidationIssues(parsed.error) })
  const { email, role, expiresIn, sendEmail } = parsed.data
  if (sendEmail && !email) {
    throw apiError('VALIDATION_FAILED', 400, {
      issues: [{ path: 'email', message: 'Enter the email address to send the invite to' }],
    })
  }
  if (sendEmail && !isSmtpConfigured())
    throw apiError('SERVICE_UNAVAILABLE', 503, { smtpError: 'SMTP is not configured' })
  if (email && (await findUserByEmail(email))) throw emailTaken()

  const token = randomToken()
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS[expiresIn])
  return useDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(userInvites)
      .values({
        tokenHash: hashToken(token),
        email: email ?? null,
        role,
        createdBy: actor.user.id,
        expiresAt,
        createdAt: now,
      })
      .returning()
    await audit(
      actor.event,
      {
        action: 'admin.invite_created',
        actorUserId: actor.user.id,
        targetType: 'invite',
        targetId: row!.id,
        details: { role, bound: email !== undefined, expiresIn, emailed: sendEmail },
      },
      { db: tx, now },
    )
    if (sendEmail && email) {
      await sendMailOr503(
        accountInviteMessage({ to: email, token, role, expiresAt, invitedBy: actor.user.displayName }),
      )
    }
    return { ...toAdminInvite(row!), token, emailed: sendEmail }
  })
}

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

export async function listAccountInvites(query: {
  page: number
  pageSize: number
  q?: string
}): Promise<Paginated<AdminInvite>> {
  const where: SQL | undefined = query.q ? ilike(userInvites.email, likePattern(query.q)) : undefined
  const db = useDb()
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(userInvites)
      .where(where)
      .orderBy(desc(userInvites.createdAt), desc(userInvites.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ n: count() }).from(userInvites).where(where),
  ])
  return { items: rows.map(toAdminInvite), page: query.page, pageSize: query.pageSize, total: total?.n ?? 0 }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function revokeAccountInvite(id: string, actor: AdminActor): Promise<AdminInvite> {
  const now = assertAdmin(actor)
  if (!UUID.test(id)) throw apiError('NOT_FOUND', 404)
  return useDb().transaction(async (tx) => {
    const [current] = await tx.select().from(userInvites).where(eq(userInvites.id, id)).for('update')
    if (!current) throw apiError('NOT_FOUND', 404)
    if (current.revokedAt) return toAdminInvite(current)
    const [row] = await tx.update(userInvites).set({ revokedAt: now }).where(eq(userInvites.id, id)).returning()
    await audit(
      actor.event,
      { action: 'admin.invite_revoked', actorUserId: actor.user.id, targetType: 'invite', targetId: id },
      { db: tx, now },
    )
    return toAdminInvite(row!)
  })
}
