/**
 * Audit totals of the API run (stage 02 DoD evidence): writes `select action, count(*) from audit_log group by 1` to
 * test-results/api-audit-summary.txt. Vitest orders files by previous duration and size, largest first, so this tiny
 * file normally runs last and sees the whole run; it asserts nothing about other files.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { REPO_ROOT, testDb } from '../_harness'

it('records the audit totals of this run', async () => {
  const rows = [
    ...(await testDb().execute<{ action: string; count: number }>(
      sql`select action, count(*)::int as count from audit_log group by 1 order by 1`,
    )),
  ]
  const text = rows.map((row) => `${row.action.padEnd(32)} ${row.count}`).join('\n')
  writeFileSync(join(REPO_ROOT, 'test-results', 'api-audit-summary.txt'), `${text}\n`)
  expect(Array.isArray(rows)).toBe(true)
})
