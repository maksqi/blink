/**
 * Helpers for the admin API tests (not a test file: Vitest only picks up *.test.ts).
 *
 * - `signedInAdmin()` / `signedInUser()`: a fresh account plus a client holding its session.
 * - `auditRows(filter)`: audit entries of the test database, oldest first.
 * - `startAdminServer(label, overrides)`: a second server on the same test database with other environment values
 *   (no SMTP, broken SMTP, unreachable LiveKit). Stop it in afterAll.
 * - `putSettings(api, patch)` / `restoreSettings(api)`: admin settings through the API; restore after every test that
 *   changes them (all API files share one server).
 * - `ADMIN_ROOM_KEYS`, `ADMIN_USER_KEYS`, `ADMIN_INVITE_KEYS`, `MEETING_KEYS`, `AUDIT_KEYS`: the documented fields.
 */
import { join } from 'node:path'
import { and, eq, type SQL } from 'drizzle-orm'
import { expect } from 'vitest'
import { SETTINGS_DEFAULTS } from '#shared/schemas/settings'
import { auditLog } from '../../../server/database/schema'
import {
  type ApiClient,
  createAdmin,
  createUser,
  loginAs,
  REPO_ROOT,
  serverEnv,
  startTestServer,
  testDb,
  type TestServer,
  type TestUser,
} from '../_harness'

export async function signedInAdmin(): Promise<{ admin: TestUser; api: ApiClient }> {
  const admin = await createAdmin()
  return { admin, api: await loginAs(admin) }
}

export async function signedInUser(): Promise<{ user: TestUser; api: ApiClient }> {
  const user = await createUser()
  return { user, api: await loginAs(user) }
}

export async function auditRows(filter: { action?: string; targetId?: string; actorUserId?: string }) {
  const conditions: SQL[] = []
  if (filter.action) conditions.push(eq(auditLog.action, filter.action))
  if (filter.targetId) conditions.push(eq(auditLog.targetId, filter.targetId))
  if (filter.actorUserId) conditions.push(eq(auditLog.actorUserId, filter.actorUserId))
  return testDb()
    .select()
    .from(auditLog)
    .where(and(...conditions))
    .orderBy(auditLog.at)
}

export function startAdminServer(label: string, overrides: Record<string, string>): Promise<TestServer> {
  return startTestServer(
    { ...serverEnv(), ...overrides },
    { logFile: join(REPO_ROOT, 'test-results', `api-admin-${label}.log`) },
  )
}

/** SMTP_HOST empty means "SMTP not configured" (env.ts treats blank values as unset). */
export const WITHOUT_SMTP = { SMTP_HOST: '', SMTP_FROM: '' }

export async function putSettings(api: ApiClient, patch: Record<string, unknown>) {
  return api.put('/api/admin/settings', { body: patch })
}

/** Puts every setting back to its default through the API. */
export async function restoreSettings(api: ApiClient): Promise<void> {
  const res = await putSettings(api, { ...SETTINGS_DEFAULTS })
  expect(res.status, res.text).toBe(200)
}

export const ADMIN_USER_KEYS = [
  'createdAt',
  'disabled',
  'displayName',
  'email',
  'emailVerified',
  'id',
  'lastLoginAt',
  'mustChangePassword',
  'role',
  'roomCount',
]
export const ADMIN_INVITE_KEYS = ['createdAt', 'createdBy', 'email', 'expiresAt', 'id', 'revoked', 'role', 'usedAt']
export const ADMIN_ROOM_KEYS = [
  'createdAt',
  'ephemeral',
  'id',
  'lastActiveAt',
  'live',
  'name',
  'owner',
  'participantCount',
  'slug',
]
export const MEETING_KEYS = ['endedAt', 'id', 'peakParticipants', 'startedAt']
export const AUDIT_KEYS = ['action', 'actor', 'at', 'details', 'id', 'ip', 'targetId', 'targetType']

export const sortedKeys = (value: object) => Object.keys(value).sort()
