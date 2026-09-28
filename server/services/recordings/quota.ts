/**
 * Per-user recording quota (`recording.userQuotaGb`, 0 = unlimited). Usage is the sum over the user's server-mode
 * recordings of `sizeBytes` once ready, otherwise the bytes uploaded so far (chunks count while they exist).
 */
import { and, eq, sql } from 'drizzle-orm'
import { useDb, type Db, type Tx } from '../../database/client'
import { recordings } from '../../database/schema'

const GIB = 1024 ** 3

/** Quota in bytes, or null for unlimited. */
export function quotaLimitBytes(quotaGb: number): number | null {
  if (!(quotaGb > 0)) return null
  return Math.floor(quotaGb * GIB)
}

/** Pure: whether `usage + additional` bytes exceed the quota. */
export function exceedsQuota(usageBytes: number, additionalBytes: number, quotaGb: number): boolean {
  const limit = quotaLimitBytes(quotaGb)
  return limit !== null && usageBytes + additionalBytes > limit
}

/** Pure: whether nothing more can be stored (starting a server recording needs some room left). */
export function quotaUsedUp(usageBytes: number, quotaGb: number): boolean {
  const limit = quotaLimitBytes(quotaGb)
  return limit !== null && usageBytes >= limit
}

export async function userUsageBytes(userId: string, db: Db | Tx = useDb()): Promise<number> {
  const [row] = await db
    .select({
      used: sql<string>`coalesce(sum(case when ${recordings.status} = 'ready' then coalesce(${recordings.sizeBytes}, 0) else ${recordings.uploadedBytes} end), 0)`,
    })
    .from(recordings)
    .where(and(eq(recordings.createdBy, userId), eq(recordings.mode, 'server')))
  return Number(row?.used ?? 0)
}
