import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { pk, tstz, updatedAt } from './_columns'
import { users } from './users'

/**
 * Admin settings (keys and zod types in shared/schemas/settings.ts) plus internal system flags
 * (keys prefixed `system.`, e.g. `system.bootstrapDone`, never exposed through the admin API).
 */
export const settings = pgTable('settings', {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedAt: updatedAt(),
  updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
})

/** Security-relevant actions. The actor is a user and/or a call participant (guests have no user id). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: pk(),
    at: tstz().notNull().defaultNow(),
    actorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    actorParticipantId: uuid(),
    ip: text(),
    action: text().notNull(),
    targetType: text(),
    targetId: text(),
    details: jsonb(),
  },
  (t) => [
    index('audit_log_at_idx').on(t.at),
    index('audit_log_actor_idx').on(t.actorUserId),
    index('audit_log_action_idx').on(t.action),
  ],
)
