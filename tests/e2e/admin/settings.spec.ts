/**
 * Admin settings: a change is saved, survives a reload and reaches the public configuration at once. The settings are
 * put back through the API afterwards so other specs in the run see the defaults.
 */
import { expect, test } from '../fixtures'

test.describe('admin settings', { tag: '@ui' }, () => {
  test('changes a setting that persists after a reload', async ({ page, baseURL, rooms }) => {
    const admin = await rooms.createUser({ role: 'admin' })
    await rooms.useIdentity(page.context(), admin)
    await page.goto('/admin/settings')
    await expect(page.getByTestId('smtp-status')).toHaveText(/Configured/)

    const guests = page.getByTestId('setting-guests.allowed')
    const roomLimit = page.getByTestId('setting-limits.maxRoomsPerUser')
    await expect(guests).toHaveAttribute('aria-checked', 'true')
    try {
      await guests.click()
      await roomLimit.fill('12')
      await expect(page.getByText('Unsaved changes')).toBeVisible()
      await page.getByTestId('save-settings').click()
      await expect(page.getByText('Settings saved. They apply right away.')).toBeVisible()

      await page.reload()
      await expect(page.getByTestId('setting-guests.allowed')).toHaveAttribute('aria-checked', 'false')
      await expect(page.getByTestId('setting-limits.maxRoomsPerUser')).toHaveValue('12')
      const config = await page.request.get('/api/config')
      expect((await config.json()).guestsAllowed).toBe(false)

      // Invalid input is explained under the field.
      await page.getByTestId('setting-limits.maxRoomsPerUser').fill('0')
      await expect(page.getByText('Use at least 1')).toBeVisible()
    } finally {
      const restored = await page.request.put('/api/admin/settings', {
        data: { 'guests.allowed': true, 'limits.maxRoomsPerUser': 50 },
        headers: { origin: new URL(baseURL!).origin },
      })
      expect(restored.status()).toBe(200)
    }
  })
})
