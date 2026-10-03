/**
 * The bootstrap admin (scripts/e2e.sh runs `cli bootstrap` with ADMIN_EMAIL / ADMIN_PASSWORD from .env.dev.example)
 * signs in, is held on /change-password until it picks a new password, then reaches the dashboard.
 * The operator CLI (`cli reset-password`) restores the first-login state before and after, so every browser project
 * starts from the same state.
 */
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { BOOTSTRAP_ADMIN, resetBootstrapAdmin, strongPassword } from './support'

/** The room list has answered and no request is left in flight. */
async function dashboardSettled(page: Page): Promise<void> {
  await expect(page.getByTestId('rooms-empty').or(page.getByTestId('room-item').first())).toBeVisible()
  await page.waitForLoadState('networkidle')
}

test.describe('first admin', { tag: '@ui' }, () => {
  test.beforeEach(() => resetBootstrapAdmin())
  test.afterEach(() => resetBootstrapAdmin())

  test('bootstrap admin → forced password change → dashboard', async ({ page, secrets }) => {
    const newPassword = strongPassword('admin')
    secrets.track(newPassword, 'new admin password')

    await page.goto('/login')
    await page.getByLabel('Email').fill(BOOTSTRAP_ADMIN.email)
    await page.getByLabel('Password', { exact: true }).fill(BOOTSTRAP_ADMIN.password)
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page).toHaveURL(/\/change-password$/)
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
    // Every other page leads back here while the change is pending (server-rendered redirect).
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/change-password$/)
    await expect(page.getByTestId('user-menu')).toHaveCount(0)

    await page.getByLabel('Current password').fill(BOOTSTRAP_ADMIN.password)
    await page.getByLabel('New password', { exact: true }).fill(newPassword)
    await page.getByLabel('Repeat new password').fill(newPassword)
    await page.getByRole('button', { name: 'Save and continue' }).click()

    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page.getByTestId('user-menu')).toBeVisible()
    // Reload only once the dashboard has settled, and end the test the same way (F-063): a reload or the closing page
    // cancels requests still in flight (the room list, link prefetches), and WebKit and sometimes Firefox report each
    // cancelled fetch or module import as a page error although the app handles it.
    await dashboardSettled(page)
    await page.reload()
    await expect(page).toHaveURL(/\/dashboard$/)
    await dashboardSettled(page)
    // The API no longer holds the account back.
    expect(await page.evaluate(async () => (await fetch('/api/auth/sessions')).status)).toBe(200)
  })
})
