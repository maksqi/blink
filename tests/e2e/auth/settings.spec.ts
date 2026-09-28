/**
 * Account settings: rename the account, then sign out another device from the sessions list.
 */
import { eq } from 'drizzle-orm'
import { sessions } from '../../../server/database/schema'
import { expect, test } from '../fixtures'
import { closeE2eDb, createOtherSession, createUser, e2eDb } from './support'

const OTHER_DEVICE = {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
  ip: '203.0.113.9',
}

test.afterAll(closeE2eDb)

test.describe('settings', { tag: '@ui' }, () => {
  test('renames the account and revokes another session', async ({ page, secrets }) => {
    const user = await createUser()
    secrets.track(user.password, 'password')
    const otherSessionId = await createOtherSession(user.id, OTHER_DEVICE)

    await page.goto('/settings')
    await expect(page).toHaveURL(/\/login\?next=(?:%2F|\/)settings$/)
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Password', { exact: true }).fill(user.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/settings$/)

    const name = page.getByLabel('Display name')
    await expect(name).toHaveValue(user.displayName)
    await name.fill('Renamed In E2E')
    await page.getByRole('button', { name: 'Save profile' }).click()
    await expect(page.getByText('Profile saved')).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('Display name')).toHaveValue('Renamed In E2E')

    await page.getByRole('link', { name: 'Devices' }).click()
    await expect(page).toHaveURL(/\/settings\/sessions$/)
    const items = page.getByTestId('session-item')
    await expect(items).toHaveCount(2)
    await expect(page.getByTestId('this-device')).toHaveCount(1)
    const other = items.filter({ hasText: 'Firefox on Linux' })
    await expect(other).toContainText(OTHER_DEVICE.ip)
    await other.getByRole('button', { name: 'Sign out Firefox on Linux' }).click()
    await expect(page.getByText('Signed out of that device')).toBeVisible()
    await expect(items).toHaveCount(1)
    await expect(items.first()).toContainText('This device')
    expect(await e2eDb().select().from(sessions).where(eq(sessions.id, otherSessionId))).toEqual([])
  })
})
