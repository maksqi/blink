import { existsSync, readFileSync } from 'node:fs'
import { e2eLogFile, expect, test } from '../fixtures/base'

// Routing contract of docker/e2e/Caddyfile (docs/TESTING.md §6.1), checked through the public origin.
test.describe('e2e Caddy routing', { tag: '@ui' }, () => {
  test('LiveKit signaling is same-origin under /rtc', async ({ request }) => {
    const response = await request.get('/rtc/v1/validate')
    // LiveKit itself answers (the app has no /rtc routes): no token means no permissions.
    expect(response.status()).toBe(401)
    expect(await response.text()).toContain('no permissions')
  })

  test('LiveKit webhooks are not reachable through the public origin', async ({ request }) => {
    const response = await request.post('/api/webhooks/livekit', {
      data: '{}',
      headers: { 'content-type': 'application/webhook+json' },
    })
    // The app would answer with its JSON error envelope; Caddy answers with an empty 404.
    expect(response.status()).toBe(404)
    expect(await response.text()).toBe('')
  })

  test('the LiveKit server API (/twirp) is never proxied', async ({ request }) => {
    const response = await request.get('/twirp/livekit.RoomService/ListRooms')
    expect(response.status()).toBe(404)
    expect(await response.text()).not.toContain('bad_route')
  })

  test('the access log redacts access_token', async ({ request, secrets }) => {
    const logFile = e2eLogFile('caddy.log')
    test.skip(!existsSync(logFile), 'needs the logs written by scripts/e2e.sh')

    // JWT-shaped but fake: LiveKit rejects it, and it must show up only as REDACTED.
    const segment = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: 'e2e-redaction-check' }, crypto.randomUUID()]
      .map(segment)
      .join('.')
    secrets.track(token, 'fake LiveKit token')

    const response = await request.get(`/rtc/v1/validate?access_token=${token}`)
    expect(response.status()).toBe(401)
    await expect.poll(() => readFileSync(logFile, 'utf8').includes('/rtc/v1/validate?access_token=REDACTED')).toBe(true)
    expect(readFileSync(logFile, 'utf8')).not.toContain(token)
    await secrets.expectNoLeaks()
  })
})
