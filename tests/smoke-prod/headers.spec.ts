import { expect, test } from '@playwright/test'
import { smoke } from './support'

const HSTS = 'max-age=31536000; includeSubDomains'

test('pages carry HSTS, the nonce CSP and the other security headers', async ({ request }) => {
  const response = await request.get('/login')
  expect(response.status()).toBe(200)
  const headers = response.headers()

  // Caddy
  expect(headers['strict-transport-security']).toBe(HSTS)
  expect(headers.server, 'Caddy removes its Server header').toBeUndefined()
  expect(headers['alt-svc'], 'HTTP/3 is advertised').toMatch(/h3=":443"/)

  // The app (nuxt-security), passed through unchanged.
  const csp = headers['content-security-policy'] ?? ''
  expect(csp).toContain("default-src 'self'")
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=_-]{16,}' 'strict-dynamic'/)
  expect(csp).toMatch(/connect-src 'self'(;|$)/)
  expect(csp).toContain("frame-ancestors 'none'")
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['referrer-policy']).toBe('no-referrer')
  expect(headers['cross-origin-opener-policy']).toBe('same-origin')
  expect(headers['cross-origin-resource-policy']).toBe('same-origin')
  expect(headers['x-frame-options']).toBe('DENY')
  const permissions = headers['permissions-policy'] ?? ''
  for (const feature of ['camera=(self)', 'microphone=(self)', 'display-capture=(self)']) {
    expect(permissions).toContain(feature)
  }

  // A fresh nonce per response.
  const again = (await request.get('/login')).headers()['content-security-policy'] ?? ''
  const nonce = (value: string) => value.match(/'nonce-([^']+)'/)?.[1]
  expect(nonce(again)).toBeTruthy()
  expect(nonce(again)).not.toBe(nonce(csp))
})

test('HSTS is on API and error responses too', async ({ request }) => {
  for (const path of ['/api/health', '/api/webhooks/livekit', '/does-not-exist']) {
    const response = await request.get(path)
    expect(response.headers()['strict-transport-security'], path).toBe(HSTS)
  }
})

test('plain HTTP redirects to HTTPS with 308', async ({ request }) => {
  const response = await request.get(`http://${smoke.domain}/login?next=%2Fdashboard`, { maxRedirects: 0 })
  expect(response.status()).toBe(308)
  expect(response.headers().location).toBe(`https://${smoke.domain}/login?next=%2Fdashboard`)
})
