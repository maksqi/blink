/**
 * Readiness for `GET /api/ready` (server-core, docs/API.md §2). Gates on the database and applied migrations only;
 * LiveKit is reported, not gating (decision in API.md).
 *
 * - `checkReadiness()` → `{ ready, checks: { db: 'ok' | 'down', migrations: 'ok' | 'pending' | 'unknown',
 *   livekit: 'ok' | 'down' } }`.
 * - migrations: the newest entry of the bundled drizzle journal must be recorded in `drizzle.__drizzle_migrations`.
 * - livekit: `GET LIVEKIT_URL` answers within 1 s (cached 5 s). Non-HTTP URLs (the `fake://` test adapter) report
 *   `down`.
 */
import { sql } from 'drizzle-orm'
import { useDb } from '../database/client'
import journal from '../database/migrations/meta/_journal.json'
import { env } from './env'

export type ReadinessChecks = {
  db: 'ok' | 'down'
  migrations: 'ok' | 'pending' | 'unknown'
  livekit: 'ok' | 'down'
}

const DB_TIMEOUT_MS = 2_000
const LIVEKIT_TIMEOUT_MS = 1_000
const LIVEKIT_CACHE_MS = 5_000

/** `when` of the newest migration this build ships with. */
export const LATEST_MIGRATION_AT = Math.max(0, ...journal.entries.map((entry) => entry.when))

export function migrationsState(appliedMaxCreatedAt: number | null): ReadinessChecks['migrations'] {
  return appliedMaxCreatedAt !== null && appliedMaxCreatedAt >= LATEST_MIGRATION_AT ? 'ok' : 'pending'
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function checkDatabase(): Promise<Pick<ReadinessChecks, 'db' | 'migrations'>> {
  const db = useDb()
  try {
    await withTimeout(db.execute(sql`select 1`), DB_TIMEOUT_MS)
  } catch {
    return { db: 'down', migrations: 'unknown' }
  }
  try {
    const rows = await withTimeout(
      db.execute<{ latest: string | number | null }>(sql`select max(created_at) as latest from drizzle.__drizzle_migrations`),
      DB_TIMEOUT_MS,
    )
    const latest = rows[0]?.latest
    return { db: 'ok', migrations: migrationsState(latest === null || latest === undefined ? null : Number(latest)) }
  } catch {
    // The migrations table does not exist yet.
    return { db: 'ok', migrations: 'pending' }
  }
}

let livekitCache: { state: ReadinessChecks['livekit']; at: number } | undefined

async function checkLivekit(): Promise<ReadinessChecks['livekit']> {
  if (livekitCache && Date.now() - livekitCache.at < LIVEKIT_CACHE_MS) return livekitCache.state
  let state: ReadinessChecks['livekit'] = 'down'
  try {
    const url = new URL(env().LIVEKIT_URL)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      const response = await fetch(url, { signal: AbortSignal.timeout(LIVEKIT_TIMEOUT_MS) })
      await response.body?.cancel()
      if (response.ok) state = 'ok'
    }
  } catch {
    state = 'down'
  }
  livekitCache = { state, at: Date.now() }
  return state
}

export async function checkReadiness(): Promise<{ ready: boolean; checks: ReadinessChecks }> {
  const [database, livekit] = await Promise.all([checkDatabase(), checkLivekit()])
  const checks: ReadinessChecks = { ...database, livekit }
  return { ready: checks.db === 'ok' && checks.migrations === 'ok', checks }
}
