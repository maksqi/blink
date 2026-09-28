import { expect, test } from '../fixtures/base'

// Harness smoke test (devops-ci): the test build answers through the e2e Caddy with the production headers. The
// guards in fixtures/base.ts fail it on any CSP violation, console error or secret in the logs.
test('home page loads through the harness with the production CSP', { tag: '@ui' }, async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.status()).toBe(200)

  const headers = response?.headers() ?? {}
  const csp = headers['content-security-policy'] ?? ''
  expect(csp).toContain("default-src 'self'")
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic' 'wasm-unsafe-eval'/)
  expect(csp).toContain("script-src-attr 'none'")
  expect(csp).toContain("frame-ancestors 'none'")
  // Same-origin signaling: the dev-only LiveKit origins must not be in a test build's CSP.
  expect(csp).toMatch(/connect-src 'self'(;|$)/)
  expect(csp).not.toContain(':7880')

  // Caddy passes the app's other security headers through unchanged.
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['referrer-policy']).toBe('no-referrer')
  expect(headers['cross-origin-opener-policy']).toBe('same-origin')
  expect(headers['permissions-policy']).toContain('camera=(self)')

  await expect(page).toHaveTitle(/blinq/)
  // Vue sets __vue_app__ on the root once the client bundle has hydrated it: the nonce-based script chain works.
  await page.waitForFunction(() => {
    const root = document.querySelector('#__nuxt') as { __vue_app__?: unknown } | null
    return Boolean(root?.__vue_app__)
  })
  await page.waitForLoadState('networkidle')
})
