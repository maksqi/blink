import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../utils/env'

type Database = ReturnType<typeof drizzle>

let sql: postgres.Sql | undefined
let database: Database | undefined

/**
 * Shared Drizzle instance (core query builder only — do not use relational `db.query.*`).
 * Production connects over the Postgres unix socket: `postgres://user:pass@localhost/db?host=/var/run/postgresql`.
 */
export function useDb(): Database {
  if (!database) {
    sql = postgres(env().DATABASE_URL, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
      onnotice: () => {},
    })
    database = drizzle({ client: sql, casing: 'snake_case' })
  }
  return database
}

export type Db = Database

/** Transaction handle type, for services that accept either the db or a transaction. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

export async function closeDb() {
  await sql?.end({ timeout: 5 })
  sql = undefined
  database = undefined
}
