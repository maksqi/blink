import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { publicConfigSchema } from '#shared/schemas/settings'
import { settings } from '../../../server/database/schema'
import { apiBaseUrl, createClient, serverEnv, testDb } from '../_harness'

describe('GET /api/config', () => {
  afterEach(async () => {
    await testDb().delete(settings).where(eq(settings.key, 'guests.allowed'))
  })

  it('matches publicConfigSchema exactly, with values from the environment', async () => {
    const res = await createClient().get('/api/config')
    expect(res.status).toBe(200)
    // parse() drops unknown keys, so equality proves there are none.
    expect(res.body).toEqual(publicConfigSchema.parse(res.body))
    expect(res.body).toMatchObject({
      appName: 'blinq',
      publicUrl: apiBaseUrl(),
      livekitUrl: serverEnv().LIVEKIT_PUBLIC_URL,
      smtpEnabled: true,
    })
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('never exposes secrets or internal settings', async () => {
    const res = await createClient().get('/api/config')
    const env = serverEnv()
    for (const secret of [env.APP_SECRET, env.LIVEKIT_API_SECRET, env.RECORDING_ENCRYPTION_KEY, env.DATABASE_URL]) {
      expect(res.text).not.toContain(secret)
    }
    expect(res.text).not.toContain('system.')
    expect(res.text).not.toContain('retentionDays')
  })

  it('reflects changed settings within the 5 s cache window', async () => {
    const api = createClient()
    await testDb()
      .insert(settings)
      .values({ key: 'guests.allowed', value: false })
      .onConflictDoUpdate({ target: settings.key, set: { value: false } })
    await expect
      .poll(async () => (await api.get('/api/config')).body.guestsAllowed, { timeout: 8_000, interval: 250 })
      .toBe(false)
  })
})
