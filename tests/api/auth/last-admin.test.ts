/**
 * Last-admin protection in the users service, on a private database where this file controls every admin:
 * demote, disable and delete of the last enabled admin → 409 CONFLICT `last_admin`, also under concurrency.
 */
import { eq } from 'drizzle-orm'
import { H3Error } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, useDb } from '../../../server/database/client'
import { users } from '../../../server/database/schema'
import {
  changeUserRole,
  deleteUser,
  setUserDisabled,
  updateUserByAdmin,
  type AdminActor,
} from '../../../server/services/users'
import { createUser } from '../../../server/services/users/users'
import { resetEnvCache } from '../../../server/utils/env'
import { createScratchDatabase, runCli, serverEnv, uniqueEmail } from '../_harness'

let scratch: Awaited<ReturnType<typeof createScratchDatabase>>

beforeAll(async () => {
  scratch = await createScratchDatabase('lastadmin')
  const migrated = await runCli(['migrate'], { ...serverEnv(), DATABASE_URL: scratch.url })
  expect(migrated.code, migrated.stderr).toBe(0)
  for (const [key, value] of Object.entries(serverEnv())) if (key !== 'NODE_ENV') vi.stubEnv(key, value)
  vi.stubEnv('DATABASE_URL', scratch.url)
  resetEnvCache()
})

afterAll(async () => {
  await closeDb()
  vi.unstubAllEnvs()
  resetEnvCache()
  await scratch?.drop()
})

beforeEach(async () => {
  await useDb().delete(users)
})

async function admin(options: { disabled?: boolean } = {}) {
  const row = await createUser({
    email: uniqueEmail('admin'),
    displayName: 'Admin',
    role: 'admin',
    emailVerified: true,
  })
  if (options.disabled) await useDb().update(users).set({ disabledAt: new Date() }).where(eq(users.id, row.id))
  return row
}

const as = (row: { id: string }): AdminActor => ({ user: { id: row.id, role: 'admin' }, event: null })

async function conflict(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    if (error instanceof H3Error && error.statusCode === 409) return (error.data as { details?: unknown }).details
    throw error
  }
  return undefined
}

describe('last enabled admin', () => {
  it('cannot be demoted, not even by itself', async () => {
    const only = await admin()
    expect(await conflict(changeUserRole(only.id, 'user', as(only)))).toEqual({ reason: 'last_admin' })
  })

  it('cannot be disabled or deleted', async () => {
    const only = await admin()
    const retired = await admin({ disabled: true }) // disabled admins do not count
    expect(await conflict(setUserDisabled(only.id, true, as(retired)))).toEqual({ reason: 'last_admin' })
    expect(await conflict(deleteUser(only.id, as(retired)))).toEqual({ reason: 'last_admin' })
    let cleaned = false
    await conflict(deleteUser(only.id, as(retired), { beforeDelete: async () => void (cleaned = true) }))
    expect(cleaned).toBe(false) // the check runs before any cleanup
  })

  it('is not protected once another enabled admin exists; then that one is the last', async () => {
    const [a, b] = [await admin(), await admin()]
    expect((await changeUserRole(a.id, 'user', as(a))).role).toBe('user') // self-demotion with another admin
    expect(await conflict(changeUserRole(b.id, 'user', as(b)))).toEqual({ reason: 'last_admin' })
    expect(await conflict(updateUserByAdmin(b.id, { disabled: true, role: 'user' }, as(a)))).toEqual({
      reason: 'last_admin',
    })
    // Renaming the last admin is fine.
    expect((await updateUserByAdmin(b.id, { displayName: 'Still Admin' }, as(b))).displayName).toBe('Still Admin')
  })

  it('survives two concurrent demotions: exactly one wins', async () => {
    const [a, b] = [await admin(), await admin()]
    const results = await Promise.allSettled([changeUserRole(a.id, 'user', as(b)), changeUserRole(b.id, 'user', as(a))])
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0]!.reason as H3Error).data).toEqual({ code: 'CONFLICT', details: { reason: 'last_admin' } })
    const admins = (await useDb().select().from(users)).filter((row) => row.role === 'admin')
    expect(admins).toHaveLength(1)
  })

  it('survives a concurrent disable and delete: one admin always remains', async () => {
    const [a, b, c] = [await admin(), await admin(), await admin({ disabled: true })]
    const results = await Promise.allSettled([setUserDisabled(a.id, true, as(c)), deleteUser(b.id, as(c))])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const enabledAdmins = (await useDb().select().from(users)).filter((row) => row.role === 'admin' && !row.disabledAt)
    expect(enabledAdmins).toHaveLength(1)
  })
})
