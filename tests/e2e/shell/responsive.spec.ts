import { expect, test, type Page } from '@playwright/test'
import { waitForApp, watchPage } from './support'

const WIDTHS = [375, 768, 1440]

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}

test.describe('responsive shell', { tag: '@responsive' }, () => {
  for (const width of WIDTHS) {
    test(`has no horizontal overflow and a reachable header at ${width}px`, async ({ page }) => {
      const watch = await watchPage(page)
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/')
      await waitForApp(page)

      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
      const header = page.getByRole('banner')
      const logo = header.getByRole('link', { name: 'blinq home' })
      const theme = header.getByRole('button', { name: 'Change theme' })
      const signIn = header.getByRole('link', { name: 'Sign in' })
      for (const control of [logo, theme, signIn]) await expect(control).toBeInViewport()

      // Keyboard: the skip link comes first and moves focus to the content without touching the URL.
      await page.keyboard.press('Tab')
      const skip = page.getByRole('link', { name: 'Skip to content' })
      await expect(skip).toBeFocused()
      await expect(skip).toBeInViewport()
      await page.keyboard.press('Enter')
      await expect(page.locator('#main')).toBeFocused()
      expect(await page.evaluate(() => location.hash)).toBe('')

      // Then logo, theme menu (opens and closes with the keyboard) and sign-in, in that order.
      await page.reload()
      await waitForApp(page)
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      await expect(logo).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(theme).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('menu')).toHaveCount(0)
      await expect(theme).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(signIn).toBeFocused()
      watch.expectClean()

      // Other shell surfaces fit too. (Only layout is checked here: dev-mode error overlays trip the CSP guard.)
      for (const path of ['/login', '/this-page-does-not-exist']) {
        await page.goto(path)
        await page.waitForLoadState('networkidle')
        expect(await horizontalOverflow(page), `${path} at ${width}px`).toBeLessThanOrEqual(0)
      }
    })
  }
})
