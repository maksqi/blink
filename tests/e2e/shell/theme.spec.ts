import { expect, test, type Page } from '@playwright/test'
import { emulateColorScheme, waitForApp, watchPage } from './support'

const STORAGE_KEY = 'blinq-color-mode'

/** Records the html class when <body> first appears (before the first paint) and every later class change. */
async function recordThemeTimeline(page: Page) {
  await page.addInitScript(() => {
    const timeline: string[] = []
    Object.defineProperty(window, '__themeTimeline', { value: timeline })
    new MutationObserver((_records, observer) => {
      const html = document.documentElement
      if (!html || !document.body) return
      observer.disconnect()
      timeline.push(`body:${html.className}`)
      new MutationObserver(() => timeline.push(`change:${html.className}`)).observe(html, {
        attributes: true,
        attributeFilter: ['class'],
      })
    }).observe(document, { childList: true, subtree: true })
  })
}

async function themeTimeline(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __themeTimeline: string[] }).__themeTimeline)
}

async function storedPreference(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)
}

async function chooseTheme(page: Page, name: 'Light' | 'Dark' | 'System') {
  await page.getByRole('button', { name: 'Change theme' }).first().click()
  await page.getByRole('menuitemradio', { name }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
}

test.describe('theme', { tag: '@ui' }, () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`follows a ${scheme} system theme by default`, async ({ page }) => {
      const watch = await watchPage(page)
      await emulateColorScheme(page, scheme)
      await page.goto('/')
      await waitForApp(page)

      const html = page.locator('html')
      await expect(html).toHaveClass(new RegExp(`\\b${scheme}\\b`))
      expect([null, 'system']).toContain(await storedPreference(page))

      // The menu shows "System" as the current choice.
      await page.getByRole('button', { name: 'Change theme' }).first().click()
      await expect(page.getByRole('menuitemradio', { name: 'System' })).toHaveAttribute('aria-checked', 'true')
      await page.keyboard.press('Escape')

      // A live change of the OS setting is followed without a reload.
      const other = scheme === 'light' ? 'dark' : 'light'
      await page.emulateMedia({ colorScheme: other })
      await expect(html).toHaveClass(new RegExp(`\\b${other}\\b`))
      await expect(html).not.toHaveClass(new RegExp(`\\b${scheme}\\b`))
      watch.expectClean()
    })
  }

  test('keeps the chosen theme across reloads', async ({ page }) => {
    const watch = await watchPage(page)
    await emulateColorScheme(page, 'light')
    await page.goto('/')
    await waitForApp(page)
    const html = page.locator('html')

    await chooseTheme(page, 'Dark')
    await expect(html).toHaveClass(/\bdark\b/)
    expect(await storedPreference(page)).toBe('dark')

    await page.reload()
    await waitForApp(page)
    await expect(html).toHaveClass(/\bdark\b/)
    await expect(html).not.toHaveClass(/\blight\b/)

    await chooseTheme(page, 'System')
    await expect(html).toHaveClass(/\blight\b/)
    await expect(html).not.toHaveClass(/\bdark\b/)
    expect(await storedPreference(page)).toBe('system')
    watch.expectClean()
  })

  test('applies a stored theme before the first paint', async ({ page, request }) => {
    // The preference lives in localStorage (color-mode `storage` default), so the server cannot render the class.
    // The color-mode head script, allowed by the per-request CSP nonce, sets it before <body> is parsed.
    const response = await request.get('/')
    const nonce = (response.headers()['content-security-policy'] ?? '').match(/'nonce-([^']+)'/)?.[1]
    const html = await response.text()
    const head = html.slice(0, html.indexOf('</head>'))
    const colorModeScript = head.match(/<script nonce="([^"]+)">[^<]*blinq-color-mode/)
    expect(colorModeScript, 'color-mode script in <head>').not.toBeNull()
    expect(colorModeScript![1]).toBe(nonce)

    const watch = await watchPage(page)
    await emulateColorScheme(page, 'light')
    await page.addInitScript((key) => localStorage.setItem(key, 'dark'), STORAGE_KEY)
    await recordThemeTimeline(page)
    await page.goto('/')
    await waitForApp(page)

    const timeline = await themeTimeline(page)
    expect(timeline[0]).toMatch(/^body:.*\bdark\b/)
    // The light system theme never shows, not even for a moment during hydration.
    expect(timeline.filter((entry) => /\blight\b/.test(entry))).toEqual([])
    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    watch.expectClean()
  })
})
