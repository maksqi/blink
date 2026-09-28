/**
 * Create and drop test databases on the shared Postgres (no vitest imports: the global setup uses it too).
 * Only names ending in `_test_api` (optionally with a suffix) are ever touched.
 */
import postgres from 'postgres'

function assertSafeName(name: string) {
  if (!/^[a-z0-9_]+_test_api(?:_[a-z0-9_]+)?$/.test(name)) throw new Error(`Refusing to touch database ${name}`)
}

async function withAdmin<T>(adminUrl: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(adminUrl, { max: 1, onnotice: () => {} })
  try {
    return await fn(sql)
  } finally {
    await sql.end({ timeout: 2 })
  }
}

export async function dropDatabase(adminUrl: string, name: string): Promise<void> {
  assertSafeName(name)
  await withAdmin(adminUrl, (sql) => sql.unsafe(`drop database if exists "${name}" with (force)`))
}

export async function recreateDatabase(adminUrl: string, name: string): Promise<void> {
  assertSafeName(name)
  await withAdmin(adminUrl, async (sql) => {
    await sql.unsafe(`drop database if exists "${name}" with (force)`)
    await sql.unsafe(`create database "${name}"`)
  })
}
