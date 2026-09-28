/**
 * Database access for API tests.
 *
 * - `testDb()`: Drizzle on the server's test database (factories, aging rows, assertions). Connections close when
 *   idle, so test workers exit cleanly.
 * - `createScratchDatabase(label)`: a fresh empty database for tests that need their own (e.g. the CLI), dropped
 *   with `drop()`. Names stay inside this worktree's namespace (`<test db>_<label>_<random>`).
 */
import { randomBytes } from 'node:crypto'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { databaseAdminUrl, testDatabaseUrl } from './context'
import { dropDatabase, recreateDatabase } from './db-admin'

export type TestDb = ReturnType<typeof drizzle>

let client: postgres.Sql | undefined
let db: TestDb | undefined

export function testDb(): TestDb {
  if (!db) {
    client = postgres(testDatabaseUrl(), { max: 4, idle_timeout: 2, onnotice: () => {} })
    db = drizzle({ client, casing: 'snake_case' })
  }
  return db
}

export async function closeTestDb(): Promise<void> {
  await client?.end({ timeout: 2 })
  client = undefined
  db = undefined
}

export async function createScratchDatabase(label: string): Promise<{ name: string; url: string; drop: () => Promise<void> }> {
  const base = new URL(testDatabaseUrl()).pathname.slice(1)
  const name = `${base}_${label.toLowerCase().replace(/[^a-z0-9]/g, '')}_${randomBytes(3).toString('hex')}`
  const adminUrl = databaseAdminUrl()
  await recreateDatabase(adminUrl, name)
  const url = new URL(testDatabaseUrl())
  url.pathname = `/${name}`
  return { name, url: url.toString(), drop: () => dropDatabase(adminUrl, name) }
}
