import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

/** Arbitrary constant shared by every blinq process that runs migrations or bootstrap. */
export const MIGRATION_LOCK_ID = 7_202_609_28

/**
 * Location of the SQL migrations. In the Docker image they are copied next to the bundle and MIGRATIONS_DIR points
 * there; in development they are read from the source tree.
 */
export function migrationsFolder(): string {
  const folder = process.env.MIGRATIONS_DIR ?? resolve(process.cwd(), 'server/database/migrations')
  if (!existsSync(resolve(folder, 'meta/_journal.json'))) {
    throw new Error(`Migrations not found in ${folder} (set MIGRATIONS_DIR)`)
  }
  return folder
}

/** Connects with retries so `docker compose up` works while Postgres is still starting. */
export async function connectWithRetry(url: string, attempts = 30, delayMs = 2000): Promise<postgres.Sql> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const sql = postgres(url, { max: 1, connect_timeout: 10, onnotice: () => {} })
    try {
      await sql`select 1`
      return sql
    } catch (error) {
      lastError = error
      await sql.end({ timeout: 1 }).catch(() => {})
      if (attempt < attempts) await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw new Error(`Database not reachable after ${attempts} attempts: ${String(lastError)}`)
}

/** Applies pending migrations under a Postgres advisory lock (safe with concurrent starters). Idempotent. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const sql = await connectWithRetry(databaseUrl)
  try {
    await sql`select pg_advisory_lock(${MIGRATION_LOCK_ID})`
    try {
      await migrate(drizzle({ client: sql, casing: 'snake_case' }), { migrationsFolder: migrationsFolder() })
    } finally {
      await sql`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}
