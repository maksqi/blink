/**
 * Daily retention (`maintenance:retention`, server-core, docs/SECURITY.md §8).
 * - IP retention (`privacy.ipRetentionDays`, default 30): IP addresses are erased from sessions, guest sessions,
 *   call participants and the audit log once the row is older; IP-keyed backoff rows are deleted.
 * - Audit retention (`audit.retentionDays`, default 180): older audit entries are deleted.
 * Recording retention belongs to `recordings:retention` (recording-server).
 * `retentionCutoffs(now, settings)` is pure; `runRetention(now)` takes the clock as a parameter.
 */
import { and, isNotNull, like, lt, or } from 'drizzle-orm'
import type { Settings } from '#shared/schemas/settings'
import { useDb, type Db } from '../../database/client'
import { auditLog, callParticipants, guestSessions, loginThrottle, sessions } from '../../database/schema'
import { getSettings } from '../settings/settings'

const DAY_MS = 24 * 3_600_000

export interface RetentionResult {
  auditDeleted: number
  ipErased: { sessions: number; guestSessions: number; callParticipants: number; auditLog: number; throttle: number }
}

export function retentionCutoffs(now: Date, settings: Pick<Settings, 'privacy.ipRetentionDays' | 'audit.retentionDays'>) {
  return {
    ipBefore: new Date(now.getTime() - settings['privacy.ipRetentionDays'] * DAY_MS),
    auditBefore: new Date(now.getTime() - settings['audit.retentionDays'] * DAY_MS),
  }
}

export async function runRetention(
  now: Date = new Date(),
  db: Db = useDb(),
  settings?: Pick<Settings, 'privacy.ipRetentionDays' | 'audit.retentionDays'>,
): Promise<RetentionResult> {
  const c = retentionCutoffs(now, settings ?? (await getSettings()))
  const auditDeleted = await db.delete(auditLog).where(lt(auditLog.at, c.auditBefore)).returning({ id: auditLog.id })
  const auditIps = await db
    .update(auditLog)
    .set({ ip: null })
    .where(and(lt(auditLog.at, c.ipBefore), isNotNull(auditLog.ip)))
    .returning({ id: auditLog.id })
  const sessionIps = await db
    .update(sessions)
    .set({ ip: null })
    .where(and(lt(sessions.createdAt, c.ipBefore), isNotNull(sessions.ip)))
    .returning({ id: sessions.id })
  const guestIps = await db
    .update(guestSessions)
    .set({ ip: null })
    .where(and(lt(guestSessions.createdAt, c.ipBefore), isNotNull(guestSessions.ip)))
    .returning({ id: guestSessions.id })
  const participantIps = await db
    .update(callParticipants)
    .set({ ip: null })
    .where(and(lt(callParticipants.createdAt, c.ipBefore), isNotNull(callParticipants.ip)))
    .returning({ id: callParticipants.id })
  const throttle = await db
    .delete(loginThrottle)
    .where(
      and(
        lt(loginThrottle.updatedAt, c.ipBefore),
        or(like(loginThrottle.key, 'ip:%'), like(loginThrottle.key, 'net:%'), like(loginThrottle.key, 'room:%')),
      ),
    )
    .returning({ key: loginThrottle.key })
  return {
    auditDeleted: auditDeleted.length,
    ipErased: {
      sessions: sessionIps.length,
      guestSessions: guestIps.length,
      callParticipants: participantIps.length,
      auditLog: auditIps.length,
      throttle: throttle.length,
    },
  }
}
