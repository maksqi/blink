/**
 * Audit-log query for admins (Stage 03, `GET /api/admin/audit`).
 *
 * - `auditFilter(query)`: pure; turns `auditQuerySchema` output into a filter description:
 *   - `q` matches the target (type or id, case-insensitive substring);
 *   - `action` is an exact action (`admin.user_created`), or a whole domain when it has no dot (`admin` matches
 *     `admin.*`) (decision);
 *   - `actorUserId` is the acting user.
 * - `toAuditEntry(row)`: pure; database row → `AuditEntry`. The actor name is the user's current display name, else the
 *   participant's in-call name; deleted users show as `null`.
 * - `listAuditLog(query)` → `Paginated<AuditEntry>`, newest first.
 * Details are returned as stored: `audit()` redacts them on write.
 */
import { and, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type { AuditEntry, auditQuerySchema } from '#shared/schemas/admin'
import type { Paginated } from '#shared/schemas/common'
import { useDb } from '../../database/client'
import { auditLog, callParticipants, users } from '../../database/schema'
import { likePattern } from './common'

export type AuditQuery = z.output<typeof auditQuerySchema>

export interface AuditFilter {
  action: { kind: 'exact' | 'domain'; value: string } | null
  actorUserId: string | null
  /** ILIKE pattern over the target type and id. */
  target: string | null
}

export function auditFilter(query: Pick<AuditQuery, 'q' | 'action' | 'actorUserId'>): AuditFilter {
  const action = query.action?.trim().toLowerCase()
  const q = query.q?.trim()
  return {
    action: action
      ? action.includes('.')
        ? { kind: 'exact', value: action }
        : { kind: 'domain', value: `${action.replace(/[\\%_]/g, (c) => `\\${c}`)}.%` }
      : null,
    actorUserId: query.actorUserId ?? null,
    target: q ? likePattern(q) : null,
  }
}

function conditions(filter: AuditFilter): SQL | undefined {
  const parts: SQL[] = []
  if (filter.action?.kind === 'exact') parts.push(eq(auditLog.action, filter.action.value))
  if (filter.action?.kind === 'domain') parts.push(sql`${auditLog.action} like ${filter.action.value}`)
  if (filter.actorUserId) parts.push(eq(auditLog.actorUserId, filter.actorUserId))
  if (filter.target) parts.push(or(ilike(auditLog.targetType, filter.target), ilike(auditLog.targetId, filter.target))!)
  return parts.length ? and(...parts) : undefined
}

export interface AuditRow {
  id: string
  at: Date
  actorUserId: string | null
  actorParticipantId: string | null
  actorUserName: string | null
  actorParticipantName: string | null
  ip: string | null
  action: string
  targetType: string | null
  targetId: string | null
  details: unknown
}

export function toAuditEntry(row: AuditRow): AuditEntry {
  const details =
    row.details && typeof row.details === 'object' && !Array.isArray(row.details)
      ? (row.details as Record<string, unknown>)
      : null
  return {
    id: row.id,
    at: row.at.toISOString(),
    actor: {
      userId: row.actorUserId,
      displayName: row.actorUserName ?? row.actorParticipantName ?? null,
      participantId: row.actorParticipantId,
    },
    ip: row.ip,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    details,
  }
}

export async function listAuditLog(query: AuditQuery): Promise<Paginated<AuditEntry>> {
  const where = conditions(auditFilter(query))
  const db = useDb()
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        at: auditLog.at,
        actorUserId: auditLog.actorUserId,
        actorParticipantId: auditLog.actorParticipantId,
        actorUserName: users.displayName,
        actorParticipantName: callParticipants.displayName,
        ip: auditLog.ip,
        action: auditLog.action,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        details: auditLog.details,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .leftJoin(callParticipants, eq(callParticipants.id, auditLog.actorParticipantId))
      .where(where)
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ n: count() }).from(auditLog).where(where),
  ])
  return { items: rows.map(toAuditEntry), page: query.page, pageSize: query.pageSize, total: total?.n ?? 0 }
}
