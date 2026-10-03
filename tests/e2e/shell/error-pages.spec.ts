import { expect, test } from '../fixtures'
import { HTTP_ERROR_CONSOLE } from '../join/support'

// F-051: the server-rendered 403 and 404 pages logged `[NUXT_E1005]` while hydrating, because the client raised the
// route error a second time. The fixtures fail a test on any console error; the browser's own note about the 4xx
// document is the only one allowed here.
test.describe('error pages', { tag: '@ui' }, () => {
  test('a signed-in non-admin gets a quiet 403 page for the admin area', async ({ page, context, rooms, guards }) => {
    guards.allowConsoleError(HTTP_ERROR_CONSOLE)
    const user = await rooms.createUser({ displayName: 'Nora Nonadmin' })
    await rooms.useIdentity(context, user)

    const response = await page.goto('/admin')
    expect(response?.status()).toBe(403)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText('Error 403')).toBeVisible()
    await waitForHydration(page)
  })

  test('an unknown page gets a quiet 404 page', async ({ page, guards }) => {
    guards.allowConsoleError(HTTP_ERROR_CONSOLE)
    const response = await page.goto(`/no-such-page-${Date.now()}`)
    expect(response?.status()).toBe(404)
    await expect(page.getByText('Error 404')).toBeVisible()
    await waitForHydration(page)
    // The page works after hydration: its main action leaves the error.
    await page.getByRole('button', { name: 'Go home' }).click()
    await expect(page).toHaveURL(/\/$/)
  })
})

async function waitForHydration(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => {
    const root = document.querySelector('#__nuxt') as (Element & { __vue_app__?: unknown }) | null
    return Boolean(root?.__vue_app__)
  })
  await page.waitForLoadState('networkidle')
}
