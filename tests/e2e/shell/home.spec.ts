import { expect, test } from '@playwright/test'
import { fragmentWrites, randomRoomKey, recordFragmentWrites, waitForApp, watchPage } from './support'

test.describe('landing page', { tag: '@ui' }, () => {
  test('is served with a strict nonce CSP and loads without errors or violations', async ({ page }) => {
    const watch = await watchPage(page)
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)

    const csp = response!.headers()['content-security-policy'] ?? ''
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1]
    expect(nonce, 'script-src carries a per-request nonce').toBeTruthy()
    expect(csp).toContain("'strict-dynamic'")
    expect(csp).toMatch(/default-src 'self'/)
    expect(csp).toMatch(/object-src 'none'/)
    expect(csp).toMatch(/frame-ancestors 'none'/)
    expect(csp).toMatch(/font-src 'self'(;|$)/)
    expect(csp).toMatch(/script-src-attr 'none'/)

    // Every script in the server-rendered HTML runs under this request's nonce (color-mode head script included).
    const html = await response!.text()
    const scripts = html.match(/<script\b[^>]*>/g) ?? []
    expect(scripts.length).toBeGreaterThan(0)
    for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`)
    // Nothing is loaded from another origin.
    expect(html).not.toMatch(/(src|href)="(https?:)?\/\/(?!localhost|127\.0\.0\.1)/)

    await waitForApp(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Private meetings on your own server')
    await expect(page.getByRole('link', { name: 'blinq home' }).first()).toBeVisible()
    await expect(page.getByRole('main').getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
    await expect(page.getByLabel('Join with a link')).toBeVisible()
    watch.expectClean()
  })

  test('rejects links that are not meetings of this server', async ({ page }) => {
    const watch = await watchPage(page)
    await page.goto('/')
    await waitForApp(page)
    const form = page.getByTestId('join-link-form')
    const input = form.getByLabel('Join with a link')
    const join = form.getByRole('button', { name: 'Join', exact: true })

    await join.click()
    await expect(form.getByRole('alert')).toHaveText('Paste a meeting link first.')
    await expect(input).toHaveAttribute('aria-invalid', 'true')

    await input.fill(`https://evil.example.com/m/abc-defg-hjk#k=${randomRoomKey()}`)
    await join.click()
    await expect(form.getByRole('alert')).toHaveText('This link belongs to another server. Open it directly in your browser.')

    await input.fill('/dashboard')
    await input.press('Enter')
    await expect(form.getByRole('alert')).toHaveText('This is not a meeting link. Meeting links look like /m/abc-defg-hjk.')
    await expect(page).toHaveURL(/\/$/)

    // Editing clears the error.
    await input.fill('/m/abc')
    await expect(form.getByRole('alert')).toHaveCount(0)
    watch.expectClean()
  })

  test('opens a pasted meeting link with a full navigation, so the key is captured and never sent', async ({
    page,
    baseURL,
  }) => {
    const watch = await watchPage(page, { ignoreResourceErrors: true })
    const key = randomRoomKey()
    const requests: string[] = []
    page.on('request', (request) => requests.push(request.url()))
    await recordFragmentWrites(page)

    await page.goto('/')
    await waitForApp(page)
    await page.getByLabel('Join with a link').fill(`${baseURL}/m/abc-defg-hjk#k=${key}`)
    await page.getByRole('button', { name: 'Join', exact: true }).click()

    await page.waitForURL((url) => url.pathname === '/m/abc-defg-hjk')
    await waitForApp(page)
    expect(await page.evaluate(() => location.hash)).toBe('')
    expect(await fragmentWrites(page)).toEqual([
      ['blinq:fragment:/m/abc-defg-hjk', { kind: 'room', k: key, invalidKey: false }],
    ])
    expect(requests.filter((url) => url.includes(key))).toEqual([])
    watch.expectClean()
  })

  test('shows a friendly 404 page without internals', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found')
    await expect(page.getByText('Error 404')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Go home' })).toBeVisible()
    const text = await page.locator('body').innerText()
    expect(text).not.toMatch(/node_modules|\.vue:\d|\bat [\w.]+ \(|Page not found: \//)

    await page.getByRole('button', { name: 'Go home' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Private meetings on your own server')
  })
})
