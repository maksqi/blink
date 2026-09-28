/**
 * Accounts (auth): lookups, creation and password storage. Emails are stored lowercased (no citext).
 *
 * - `findUserById(id)`, `findUserByEmail(email)` → `UserRow | undefined`.
 * - `createUser(input, db?)` → `UserRow`; 409 `CONFLICT` (`details.reason = 'email_taken'`) when the email exists
 *   (also under concurrency, via the unique index). Pass `passwordHash` (hash before opening a transaction) or
 *   `password`; either creates the `password` identity. `emailVerified` marks the address as confirmed.
 * - `setPassword(userId, password, { mustChangePassword })`: new argon2id hash (+ identity). Revoking sessions is
 *   the caller's decision.
 * - `toAuthUser(row)`, `normalizeEmail(email)`, `emailDomain(email)`, `isUniqueViolation(error)`.
 */
import { eq, sql } from 'drizzle-orm'
import type { AuthUser, UserRole } from '#shared/schemas/auth'
import { useDb, type Db, type Tx } from '../../database/client'
import { authIdentities, users } from '../../database/schema'
import { apiError } from '../../utils/api-error'
import { hashPassword } from '../../utils/password'

export type UserRow = typeof users.$inferSelect

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function emailDomain(email: string): string {
  const address = normalizeEmail(email)
  return address.slice(address.lastIndexOf('@') + 1)
}

export function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    mustChangePassword: row.mustChangePassword,
    emailVerified: row.emailVerifiedAt !== null,
  }
}

/** Postgres unique violation (23505), directly or wrapped by Drizzle. */
export function isUniqueViolation(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 4; depth++) {
    if (typeof current === 'object' && (current as { code?: unknown }).code === '23505') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

export const emailTaken = () => apiError('CONFLICT', 409, { reason: 'email_taken' })

export async function findUserById(id: string, db: Db | Tx = useDb()): Promise<UserRow | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  return row
}

export async function findUserByEmail(email: string, db: Db | Tx = useDb()): Promise<UserRow | undefined> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizeEmail(email)))
    .limit(1)
  return row
}

export interface CreateUserInput {
  email: string
  displayName: string
  role?: UserRole
  /** Plain password (hashed here) ... */
  password?: string
  /** ... or a hash computed earlier, outside the transaction. Omit both for external-only accounts. */
  passwordHash?: string | null
  mustChangePassword?: boolean
  emailVerified?: boolean
  now?: Date
}

export async function createUser(input: CreateUserInput, db: Db | Tx = useDb()): Promise<UserRow> {
  const now = input.now ?? new Date()
  const email = normalizeEmail(input.email)
  const passwordHash = input.passwordHash ?? (input.password === undefined ? null : await hashPassword(input.password))
  let row: UserRow | undefined
  try {
    ;[row] = await db
      .insert(users)
      .values({
        email,
        displayName: input.displayName,
        role: input.role ?? 'user',
        passwordHash,
        mustChangePassword: input.mustChangePassword ?? false,
        emailVerifiedAt: input.emailVerified ? now : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  } catch (error) {
    if (isUniqueViolation(error)) throw emailTaken()
    throw error
  }
  if (passwordHash) {
    await db.insert(authIdentities).values({ userId: row!.id, provider: 'password', subject: row!.id, email })
  }
  return row!
}

export async function setPassword(
  userId: string,
  password: string,
  options: { mustChangePassword: boolean; markEmailVerified?: boolean; now?: Date; db?: Db | Tx },
): Promise<UserRow> {
  const db = options.db ?? useDb()
  const now = options.now ?? new Date()
  const passwordHash = await hashPassword(password)
  const [row] = await db
    .update(users)
    .set({
      passwordHash,
      mustChangePassword: options.mustChangePassword,
      // Raw sql gets an ISO string: postgres-js does not serialize Date parameters inside sql fragments.
      ...(options.markEmailVerified
        ? { emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, ${now.toISOString()}::timestamptz)` }
        : {}),
      updatedAt: now,
    })
    .where(eq(users.id, userId))
    .returning()
  if (!row) throw apiError('NOT_FOUND', 404)
  await db
    .insert(authIdentities)
    .values({ userId, provider: 'password', subject: userId, email: row.email })
    .onConflictDoNothing()
  return row
}
