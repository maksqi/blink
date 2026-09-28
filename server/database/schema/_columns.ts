import { sql } from 'drizzle-orm'
import { timestamp, uuid } from 'drizzle-orm/pg-core'

/** Time-ordered UUID primary key (PostgreSQL 18 `uuidv7()`). */
export const pk = () =>
  uuid()
    .primaryKey()
    .default(sql`uuidv7()`)

/** `timestamptz`, always UTC. */
export const tstz = () => timestamp({ withTimezone: true, mode: 'date' })

export const createdAt = () => tstz().notNull().defaultNow()

export const updatedAt = () =>
  tstz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
