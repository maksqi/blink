import { randomBytes } from 'node:crypto'
import type { Page, Request } from '@playwright/test'
import { expect, test } from '../fixtures'
import { randomRoomKey } from '../shell/support'

/**
 * F-020: a server-rendered form that is used before the app has hydrated submits natively. Without a method that is
 * `GET /login?email=…&password=…` or `GET /?link=…%23k%3D<room key>`: the secret lands in the address bar, the
 * history and the proxy log. JavaScript is off for these pages, which is the state of every page until hydration.
 */
test.describe('forms before hydration', { tag: '@ui' }, () => {
  test.use({ javaScriptEnabled: false })

  function recordRequests(page: Page): Request[] {
    const requests: Request[] = []
    page.on('request', (request) => requests.push(request))
    return requests
  }

  /** Resolves true when the page navigates within `ms`. */
  function navigates(page: Page, ms = 1_500): Promise<boolean> {
    return page.waitForEvent('framenavigated', { timeout: ms }).then(
      () => true,
      () => false,
    )
  }

  function expectNotSent(requests: Request[], secret: string) {
    for (const request of requests) {
      expect(decodeURIComponent(request.url()), request.url()).not.toContain(secret)
      expect(request.postData() ?? '', request.url()).not.toContain(secret)
    }
  }

  test('the sign-in form neither submits nor puts the password into a URL', async ({ page, baseURL, secrets }) => {
    const password = `pw-${randomBytes(12).toString('hex')}`
    secrets.track(password, 'password typed before hydration')
    const requests = recordRequests(page)
    await page.goto('/login')

    const form = page.getByTestId('login-form')
    await expect(form).toHaveAttribute('method', 'post')
    await expect(form.getByRole('button', { name: 'Sign in' })).toBeDisabled()
    await page.getByLabel('Email').fill('someone@example.test')
    await page.locator('#login-password').fill(password)

    const navigated = navigates(page)
    await page.locator('#login-password').press('Enter')
    expect(await navigated).toBe(false)
    expect(page.url()).toBe(`${baseURL}/login`)
    expectNotSent(requests, password)
  })

  test('the join-with-a-link form neither submits nor sends the room key anywhere', async ({
    page,
    baseURL,
    secrets,
  }) => {
    const key = randomRoomKey()
    secrets.track(key, 'room key typed before hydration')
    const requests = recordRequests(page)
    await page.goto('/')

    const form = page.getByTestId('join-link-form')
    await expect(form).toHaveAttribute('method', 'post')
    await expect(form.getByRole('button', { name: 'Join', exact: true })).toBeDisabled()
    const link = page.getByLabel('Join with a link')
    // Without a name the field is never part of a native submission.
    await expect(link).not.toHaveAttribute('name')
    await link.fill(`${baseURL}/m/abc-defg-hjk#k=${key}`)

    const navigated = navigates(page)
    await link.press('Enter')
    expect(await navigated).toBe(false)
    expect(page.url()).toBe(`${baseURL}/`)
    expectNotSent(requests, key)
  })
})
