import { expect, test } from '@playwright/test'

// Liveness and readiness through Caddy: the app runs, the database answers over the unix socket, every migration is
// applied, and LiveKit's API is reachable on loopback.
test('health and readiness answer through Caddy', async ({ request }) => {
  const health = await request.get('/api/health')
  expect(health.status()).toBe(200)
  expect(await health.json()).toEqual({ status: 'ok' })

  const ready = await request.get('/api/ready')
  expect(ready.status(), await ready.text()).toBe(200)
  expect(await ready.json()).toMatchObject({ status: 'ready', checks: { db: 'ok', migrations: 'ok', livekit: 'ok' } })
})
