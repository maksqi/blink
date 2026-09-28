/**
 * Last-admin protection (auth, docs/API.md §9): the last enabled admin cannot be demoted, disabled or deleted
 * (409 `CONFLICT`, `details.reason = 'last_admin'`).
 *
 * - `wouldRemoveLastAdmin(enabledAdminIds, targetId)`: pure rule.
 * - `lockEnabledAdmins(tx)`: `SELECT id … WHERE role = 'admin' AND disabled_at IS NULL ORDER BY id FOR UPDATE`.
 *   Call it first in the transaction (before locking the target row): the fixed lock order means two concurrent
 *   demotions serialize instead of deadlocking, and the second one sees the first one's result.
 * - `assertKeepsAnAdmin(tx, targetId)`: both together.
 */
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Tx } from '../../database/client'
import { users } from '../../database/schema'
import { apiError } from '../../utils/api-error'

export function wouldRemoveLastAdmin(enabledAdminIds: readonly string[], targetId: string): boolean {
  return enabledAdminIds.includes(targetId) && enabledAdminIds.length <= 1
}

export const lastAdminConflict = () => apiError('CONFLICT', 409, { reason: 'last_admin' })

export async function lockEnabledAdmins(tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'admin'), isNull(users.disabledAt)))
    .orderBy(asc(users.id))
    .for('update')
  return rows.map((row) => row.id)
}

export async function assertKeepsAnAdmin(tx: Tx, targetId: string): Promise<void> {
  if (wouldRemoveLastAdmin(await lockEnabledAdmins(tx), targetId)) throw lastAdminConflict()
}
