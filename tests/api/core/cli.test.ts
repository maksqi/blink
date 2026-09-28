/**
 * The bundled CLI (.output/server/cli.mjs) against scratch databases: migrate and bootstrap are idempotent,
 * bootstrap refuses bad credentials only while pending, reset-password revokes sessions and audits.
 */
import { and, count, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import journal from '../../../server/database/migrations/meta/_journal.json'
import { auditLog, authIdentities, loginThrottle, sessions, settings, users } from '../../../server/database/schema'
import { hashToken, randomToken } from '../../../server/utils/crypto'
import { verifyPassword } from '../../../server/utils/password'
import { createScratchDatabase, runCli, serverEnv, uniqueEmail } from '../_harness'

const cleanups: Array<() => Promise<void>> = []

afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
})

async function freshDatabase() {
  const scratch = await createScratchDatabase('cli')
  const client = postgres(scratch.url, { max: 2, idle_timeout: 2, onnotice: () => {} })
  cleanups.push(async () => {
    await client.end({ timeout: 2 })
    await scratch.drop()
  })
  const env = (extra: Record<string, string> = {}) => ({ ...serverEnv(), DATABASE_URL: scratch.url, ...extra })
  const migrated = await runCli(['migrate'], env())
  expect(migrated.code, migrated.stderr).toBe(0)
  return { db: drizzle({ client, casing: 'snake_case' }), client, env }
}

const ADMIN_PASSWORD = 'violet-harbor-lantern-42'

async function snapshot(db: ReturnType<typeof drizzle>) {
  return {
    users: await db.select().from(users).orderBy(users.email),
    identities: await db.select().from(authIdentities),
    settings: await db.select({ key: settings.key, value: settings.value }).from(settings),
    audit: await db.select({ action: auditLog.action, targetId: auditLog.targetId }).from(auditLog),
  }
}

describe('cli migrate', () => {
  it('is idempotent', async () => {
    const { client, env } = await freshDatabase()
    const again = await runCli(['migrate'], env())
    expect(again.code, again.stderr).toBe(0)
    expect(again.stdout).toContain('migrations applied')
    const rows = await client`select count(*)::int as n from drizzle.__drizzle_migrations`
    expect(rows[0]!.n).toBe(journal.entries.length)
  })
})

describe('cli bootstrap', () => {
  it('creates the first admin once; running migrate and bootstrap again changes nothing', async () => {
    const { db, env } = await freshDatabase()
    const email = uniqueEmail('admin')
    const bootEnv = env({ ADMIN_EMAIL: email.toUpperCase(), ADMIN_PASSWORD })

    const first = await runCli(['bootstrap'], bootEnv)
    expect(first.code, first.stderr).toBe(0)
    expect(first.stdout).toContain('created the admin account')
    expect(first.stdout + first.stderr).not.toContain(ADMIN_PASSWORD)
    const before = await snapshot(db)

    expect(before.users).toHaveLength(1)
    const admin = before.users[0]!
    expect(admin).toMatchObject({ email, role: 'admin', mustChangePassword: true, displayName: 'Administrator' })
    expect(admin.emailVerifiedAt).not.toBeNull()
    expect(admin.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/)
    expect(await verifyPassword(admin.passwordHash!, ADMIN_PASSWORD)).toBe(true)
    expect(before.identities).toMatchObject([{ userId: admin.id, provider: 'password', subject: admin.id }])
    expect(before.settings.map((s) => s.key)).toEqual(['system.bootstrapDone'])
    expect(before.audit).toEqual([{ action: 'system.bootstrap', targetId: admin.id }])

    expect((await runCli(['migrate'], bootEnv)).code).toBe(0)
    const second = await runCli(['bootstrap'], env({ ADMIN_EMAIL: uniqueEmail('other'), ADMIN_PASSWORD: 'short' }))
    expect(second.code, second.stderr).toBe(0)
    expect(second.stdout).toContain('nothing to do')
    expect(await snapshot(db)).toEqual(before)
  })

  it.each([
    ['a placeholder password', { ADMIN_PASSWORD: 'change-me-first-login-password' }, /placeholder/],
    ['a short password', { ADMIN_PASSWORD: 'short-pass' }, /shorter than 12/],
    ['a common password', { ADMIN_PASSWORD: 'qwerty123456' }, /too common/],
    ['no password', { ADMIN_PASSWORD: '' }, /Set ADMIN_EMAIL and ADMIN_PASSWORD/],
    ['an invalid email', { ADMIN_EMAIL: 'not-an-email' }, /ADMIN_EMAIL is not a valid/],
  ])('refuses %s while pending (exit 1, nothing written)', async (_, overrides, message) => {
    const { db, env } = await freshDatabase()
    const result = await runCli(['bootstrap'], env({ ADMIN_EMAIL: uniqueEmail('admin'), ADMIN_PASSWORD, ...overrides }))
    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(message)
    const state = await snapshot(db)
    expect(state.users).toHaveLength(0)
    expect(state.settings).toHaveLength(0)
  })

  it('only marks bootstrap done when an admin already exists', async () => {
    const { db, env } = await freshDatabase()
    await db.insert(users).values({ email: uniqueEmail('existing'), displayName: 'Existing', role: 'admin' })
    const result = await runCli(['bootstrap'], env({ ADMIN_EMAIL: uniqueEmail('admin'), ADMIN_PASSWORD: 'short' }))
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('already exists')
    const state = await snapshot(db)
    expect(state.users).toHaveLength(1)
    expect(state.settings.map((s) => s.key)).toEqual(['system.bootstrapDone'])
  })
})

describe('cli reset-password', () => {
  async function withAdmin() {
    const context = await freshDatabase()
    const email = uniqueEmail('admin')
    const boot = await runCli(['bootstrap'], context.env({ ADMIN_EMAIL: email, ADMIN_PASSWORD }))
    expect(boot.code, boot.stderr).toBe(0)
    const [admin] = await context.db.select().from(users).where(eq(users.email, email))
    return { ...context, email, admin: admin! }
  }

  it('stores the new password, requires a change, revokes sessions, clears backoff and audits', async () => {
    const { db, env, email, admin } = await withAdmin()
    await db.update(users).set({ mustChangePassword: false }).where(eq(users.id, admin.id))
    const expiresAt = new Date(Date.now() + 86_400_000)
    await db.insert(sessions).values([
      { id: hashToken(randomToken()), userId: admin.id, expiresAt },
      { id: hashToken(randomToken()), userId: admin.id, expiresAt },
    ])
    await db.insert(loginThrottle).values({ key: `email:${email}`, failures: 12, nextAllowedAt: expiresAt })

    const newPassword = 'glacier-paper-moth-19-x'
    const result = await runCli(['reset-password', email.toUpperCase()], env(), `${newPassword}\n`)
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('2 session(s) revoked')
    expect(result.stdout + result.stderr).not.toContain(newPassword)

    const [updated] = await db.select().from(users).where(eq(users.id, admin.id))
    expect(updated!.mustChangePassword).toBe(true)
    expect(await verifyPassword(updated!.passwordHash!, newPassword)).toBe(true)
    expect(await verifyPassword(updated!.passwordHash!, ADMIN_PASSWORD)).toBe(false)
    expect((await db.select({ n: count() }).from(sessions).where(eq(sessions.userId, admin.id)))[0]!.n).toBe(0)
    expect(await db.select().from(loginThrottle)).toHaveLength(0)
    const entries = await db
      .select({ targetId: auditLog.targetId, details: auditLog.details })
      .from(auditLog)
      .where(and(eq(auditLog.action, 'system.reset_password')))
    expect(entries).toEqual([{ targetId: admin.id, details: { via: 'cli' } }])
  })

  it('refuses weak passwords and unknown accounts without changing anything', async () => {
    const { db, env, email, admin } = await withAdmin()
    const weak = await runCli(['reset-password', email], env(), 'short\n')
    expect(weak.code).toBe(1)
    expect(weak.stderr).toMatch(/shorter than 12/)
    const unknown = await runCli(['reset-password', uniqueEmail('nobody')], env(), 'glacier-paper-moth-19-x\n')
    expect(unknown.code).toBe(1)
    expect(unknown.stderr).toMatch(/No account uses/)
    const [same] = await db.select().from(users).where(eq(users.id, admin.id))
    expect(same!.passwordHash).toBe(admin.passwordHash)
  })

  it('never takes the password from argv', async () => {
    const { env, email } = await withAdmin()
    const result = await runCli(['reset-password', email, 'glacier-paper-moth-19-x'], env())
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('Usage')
  })
})
