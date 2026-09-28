import { request } from 'node:http'
import { describe, expect, it } from 'vitest'
import { apiBaseUrl, createClient, expectApiError } from '../_harness'

// POST /api/auth/logout is a W0a stub: reaching it means the CSRF check passed (501 until auth implements it,
// then 401 for anonymous callers). Either way it is never CSRF_REJECTED.
const passed = (status: number) => expect([401, 501]).toContain(status)

describe('CSRF', () => {
  it('rejects mutations without Origin', async () => {
    expectApiError(await createClient().post('/api/auth/logout', { origin: null }), 403, 'CSRF_REJECTED')
  })

  it.each(['https://evil.test', 'null', 'http://127.0.0.1', 'http://localhost'])('rejects Origin %s', async (origin) => {
    expectApiError(await createClient().post('/api/auth/logout', { origin }), 403, 'CSRF_REJECTED')
  })

  it('rejects a same-origin Origin with a trailing slash or another port', async () => {
    const api = createClient()
    expectApiError(await api.post('/api/auth/logout', { origin: `${apiBaseUrl()}/` }), 403, 'CSRF_REJECTED')
    const other = new URL(apiBaseUrl())
    other.port = String(Number(other.port) + 1)
    expectApiError(await api.post('/api/auth/logout', { origin: other.origin }), 403, 'CSRF_REJECTED')
  })

  it.each(['cross-site', 'same-site', 'none'])('rejects Sec-Fetch-Site: %s even with the right Origin', async (site) => {
    const res = await createClient().post('/api/auth/logout', { headers: { 'sec-fetch-site': site } })
    expectApiError(res, 403, 'CSRF_REJECTED')
  })

  it('accepts the public origin with or without Sec-Fetch-Site: same-origin', async () => {
    const api = createClient()
    passed((await api.post('/api/auth/logout')).status)
    passed((await api.post('/api/auth/logout', { headers: { 'sec-fetch-site': 'same-origin' } })).status)
  })

  it.each([
    ['PUT', '/api/rooms/0192d2f4-7a3b-7cde-8f01-23456789abcd/key'],
    ['PATCH', '/api/me'],
    ['DELETE', '/api/rooms/0192d2f4-7a3b-7cde-8f01-23456789abcd'],
    ['POST', '/api/rooms'],
  ])('checks %s %s', async (method, path) => {
    expectApiError(await createClient().request(method, path, { origin: 'https://evil.test' }), 403, 'CSRF_REJECTED')
  })

  it('never checks safe methods', async () => {
    const res = await createClient().get('/api/config', { origin: 'https://evil.test' })
    expect(res.status).toBe(200)
  })

  it('exempts only POST /api/webhooks/livekit', async () => {
    const res = await createClient().post('/api/webhooks/livekit', { origin: null, raw: '{}' })
    expect(res.body?.data?.code).not.toBe('CSRF_REJECTED')
    expectApiError(await createClient().put('/api/webhooks/livekit', { origin: null }), 403, 'CSRF_REJECTED')
  })

  it('does not trust Host or X-Forwarded-Host', async () => {
    const forwarded = await createClient().post('/api/auth/logout', {
      origin: 'https://evil.test',
      headers: { 'x-forwarded-host': 'evil.test', 'x-forwarded-proto': 'https' },
    })
    expectApiError(forwarded, 403, 'CSRF_REJECTED')

    const url = new URL('/api/auth/logout', apiBaseUrl())
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(url, { method: 'POST', headers: { host: 'evil.test', origin: 'http://evil.test' } }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end()
    })
    expect(status).toBe(403)
  })
})
