/**
 * Helpers for the auth API tests (not a test file: Vitest only picks up *.test.ts).
 *
 * - `setRegistration(mode, domains)` / `resetRegistration()`: write the settings rows and wait until the running server
 *   serves them (its settings cache lives up to 5 s; the wait proves the switch needs no restart).
 * - `startExtraServer(label, overrides, options)`: a second server on the same test database, e.g. without SMTP or
 *   behind an https PUBLIC_URL. Stop it in afterAll.
 * - `signIn(client, email, password)`, `mailToken(to, path, subject)`, `createEmailToken(userId, purpose, times)`,
 *   `auditRows(filter)`, `sessionIds(userId)`, `uniqueDomainEmail(domain)`, `sleep(ms)`.
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { and, eq, inArray, type SQL } from 'drizzle-orm'
import { expect } from 'vitest'
import { auditLog, emailTokens, sessions, settings } from '../../../server/database/schema'
import { hashToken, randomToken } from '../../../server/utils/crypto'
import {
  type ApiClient,
  type ApiResponse,
  createClient,
  extractFragmentToken,
  REPO_ROOT,
  serverEnv,
  startTestServer,
  testDb,
  type TestServer,
  waitForMessage,
} from '../_harness'

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function uniqueDomainEmail(domain: string, prefix = 'u'): string {
  return `${prefix}-${randomUUID()}@${domain}`
}

// ---- Registration settings --------------------------------------------------------------------------------------

type Mode = 'invite_only' | 'open' | 'domain'

async function waitForRegistration(mode: Mode, domains: string[], client: ApiClient = createClient()): Promise<void> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const res = await client.get('/api/config')
    const current = res.body?.registration
    if (current?.mode === mode && JSON.stringify(current.allowedDomains) === JSON.stringify(domains)) return
    if (Date.now() > deadline) throw new Error(`The server still serves registration ${JSON.stringify(current)}`)
    await sleep(250)
  }
}

export async function setRegistration(mode: Mode, allowedDomains: string[] = [], client?: ApiClient): Promise<void> {
  const db = testDb()
  for (const [key, value] of [
    ['registration.mode', mode],
    ['registration.allowedDomains', allowedDomains],
  ] as const) {
    await db
      .insert(settings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } })
  }
  await waitForRegistration(mode, allowedDomains, client)
}

export async function resetRegistration(client?: ApiClient): Promise<void> {
  await testDb()
    .delete(settings)
    .where(inArray(settings.key, ['registration.mode', 'registration.allowedDomains']))
  await waitForRegistration('invite_only', [], client)
}

// ---- Extra servers ------------------------------------------------------------------------------------------------

export async function startExtraServer(
  label: string,
  overrides: Record<string, string> = {},
  options: { publicUrl?: string } = {},
): Promise<TestServer> {
  return startTestServer(
    { ...serverEnv(), ...overrides },
    { logFile: join(REPO_ROOT, 'test-results', `api-auth-${label}.log`), publicUrl: options.publicUrl },
  )
}

/** SMTP_HOST empty means "SMTP not configured" (env.ts treats blank values as unset). */
export const WITHOUT_SMTP = { SMTP_HOST: '', SMTP_FROM: '' }

// ---- Flows ----------------------------------------------------------------------------------------------------------

export function signIn(
  client: ApiClient,
  email: string,
  password: string,
  options: { origin?: string } = {},
): Promise<ApiResponse> {
  return client.post('/api/auth/login', {
    body: { email, password },
    ...(options.origin ? { origin: options.origin } : {}),
  })
}

export async function mailToken(
  to: string,
  path: '/invite' | '/verify-email' | '/reset-password',
  subject: RegExp,
): Promise<string> {
  const mail = await waitForMessage(to, { subject })
  const token = extractFragmentToken(mail.Text, path)
  expect(token, `a ${path} link in the mail to ${to}`).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(extractFragmentToken(mail.HTML, path)).toBe(token)
  return token!
}

export async function createEmailToken(
  userId: string,
  purpose: 'verify_email' | 'reset_password',
  times: { expiresAt?: Date; usedAt?: Date | null } = {},
): Promise<string> {
  const token = randomToken()
  await testDb()
    .insert(emailTokens)
    .values({
      userId,
      purpose,
      tokenHash: hashToken(token),
      expiresAt: times.expiresAt ?? new Date(Date.now() + 3_600_000),
      usedAt: times.usedAt ?? null,
    })
  return token
}

export async function expireEmailToken(token: string): Promise<void> {
  await testDb()
    .update(emailTokens)
    .set({ expiresAt: new Date(Date.now() - 1_000) })
    .where(eq(emailTokens.tokenHash, hashToken(token)))
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

export async function sessionIds(userId: string): Promise<string[]> {
  const rows = await testDb().select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId))
  return rows.map((row) => row.id).sort()
}

/** The session cookie of a response (`blinq_session` on http, `__Host-blinq_session` on https). */
export function sessionCookie(res: ApiResponse): { name: string; value: string; attributes: string[] } | undefined {
  const header = res.setCookies.find((cookie) => /^(?:__Host-)?blinq_session=/.test(cookie))
  if (!header) return undefined
  const [pair, ...attributes] = header.split(';').map((part) => part.trim())
  const index = pair!.indexOf('=')
  return { name: pair!.slice(0, index), value: pair!.slice(index + 1), attributes }
}
