/**
 * Helpers for the auth E2E specs. They run inside `sh scripts/e2e.sh`, which exports the E2E environment
 * (DATABASE_URL of the e2e database, ADMIN_EMAIL/ADMIN_PASSWORD of the bootstrap admin, PUBLIC_URL). Test data goes
 * straight into the e2e database, like the API factories; mail comes from the shared Mailpit (search by recipient).
 */
import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sessions, userInvites, users } from '../../../server/database/schema'
import { hashToken, randomToken } from '../../../server/utils/crypto'
import { hashPassword } from '../../../server/utils/password'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025'
const DAY = 24 * 3_600_000

export const BOOTSTRAP_ADMIN = {
  email: (process.env.ADMIN_EMAIL ?? 'admin@blinq.local').toLowerCase(),
  password: process.env.ADMIN_PASSWORD ?? '',
}

let client: postgres.Sql | undefined
let db: ReturnType<typeof drizzle> | undefined

export function e2eDb() {
  if (!db) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set: run the E2E specs with sh scripts/e2e.sh')
    client = postgres(url, { max: 2, idle_timeout: 2, onnotice: () => {} })
    db = drizzle({ client, casing: 'snake_case' })
  }
  return db
}

export async function closeE2eDb(): Promise<void> {
  await client?.end({ timeout: 2 })
  client = undefined
  db = undefined
}

export function uniqueEmail(prefix = 'e2e'): string {
  return `${prefix}-${randomUUID()}@example.test`
}

export function strongPassword(prefix = 'e2e'): string {
  return `${prefix}-${randomBytes(8).toString('hex')}-harbor`
}

export async function createUser(options: { email?: string; password?: string; displayName?: string } = {}) {
  const email = options.email ?? uniqueEmail()
  const password = options.password ?? strongPassword('user')
  const [row] = await e2eDb()
    .insert(users)
    .values({
      email,
      displayName: options.displayName ?? `E2E ${randomBytes(3).toString('hex')}`,
      passwordHash: await hashPassword(password),
      emailVerifiedAt: new Date(),
    })
    .returning()
  return { ...row!, password }
}

/** A session of the same account on "another device". */
export async function createOtherSession(userId: string, device: { userAgent: string; ip: string }): Promise<string> {
  const token = randomToken()
  const now = new Date()
  await e2eDb()
    .insert(sessions)
    .values({
      id: hashToken(token),
      userId,
      createdAt: new Date(now.getTime() - 60_000),
      lastSeenAt: new Date(now.getTime() - 60_000),
      expiresAt: new Date(now.getTime() + 30 * DAY),
      ip: device.ip,
      userAgent: device.userAgent,
    })
  return hashToken(token)
}

export async function createInvite(options: { email?: string; role?: 'admin' | 'user' } = {}) {
  const token = randomToken()
  const [row] = await e2eDb()
    .insert(userInvites)
    .values({
      tokenHash: hashToken(token),
      email: options.email ?? null,
      role: options.role ?? 'user',
      expiresAt: new Date(Date.now() + DAY),
    })
    .returning()
  return { ...row!, token }
}

/** Puts the bootstrap admin back into its first-login state with the operator CLI (`cli reset-password`). */
export function resetBootstrapAdmin(): void {
  if (!BOOTSTRAP_ADMIN.password) throw new Error('ADMIN_PASSWORD is not set: run the E2E specs with sh scripts/e2e.sh')
  execFileSync(process.execPath, ['.output/server/cli.mjs', 'reset-password', BOOTSTRAP_ADMIN.email], {
    cwd: REPO_ROOT,
    env: process.env,
    input: `${BOOTSTRAP_ADMIN.password}\n`,
    stdio: ['pipe', 'ignore', 'pipe'],
  })
}

interface MailSummary {
  ID: string
  Subject: string
}

/** Waits for a message to `to` whose subject matches, and returns its plain-text body. */
export async function waitForMail(to: string, subject: RegExp, timeoutMs = 15_000): Promise<string> {
  let text: string | undefined
  await expect
    .poll(
      async () => {
        const res = await fetch(`${MAILPIT}/api/v1/search?${new URLSearchParams({ query: `to:"${to}"` })}`)
        const found = ((await res.json()) as { messages: MailSummary[] }).messages.find((m) => subject.test(m.Subject))
        if (!found) return false
        text = ((await (await fetch(`${MAILPIT}/api/v1/message/${found.ID}`)).json()) as { Text: string }).Text
        return true
      },
      { timeout: timeoutMs, message: `an email to ${to} matching ${subject}` },
    )
    .toBe(true)
  return text!
}

/** The first `<origin><path>#<token>` link of a message. */
export function tokenLink(
  text: string,
  path: '/invite' | '/verify-email' | '/reset-password',
): { url: string; token: string } {
  const match = text.match(new RegExp(`(https?://[^\\s/]+${path})#([A-Za-z0-9_-]{43})`))
  if (!match) throw new Error(`No ${path} link in the message`)
  return { url: `${match[1]}#${match[2]}`, token: match[2]! }
}
