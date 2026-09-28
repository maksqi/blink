import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, expectApiError, REPO_ROOT, serverEnv, startTestServer, type TestServer } from '../_harness'

describe('GET /api/health', () => {
  it('answers 200 { status: "ok" } without caching', async () => {
    const res = await createClient().get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('sets a fresh X-Request-Id and ignores the client value', async () => {
    const api = createClient()
    const a = await api.get('/api/health', { headers: { 'x-request-id': 'client-chosen-id' } })
    const b = await api.get('/api/health')
    const id = a.headers.get('x-request-id')
    expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/)
    expect(id).not.toBe('client-chosen-id')
    expect(b.headers.get('x-request-id')).not.toBe(id)
  })
})

describe('GET /api/ready', () => {
  it('reports the database, migrations and LiveKit', async () => {
    const res = await createClient().get('/api/ready')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'ready', checks: { db: 'ok', migrations: 'ok' } })
    expect(['ok', 'down']).toContain(res.body.checks.livekit)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  describe('without a database', () => {
    let server: TestServer

    beforeAll(async () => {
      server = await startTestServer(
        { ...serverEnv(), DATABASE_URL: 'postgres://blinq:unused@127.0.0.1:1/unreachable' },
        { logFile: join(REPO_ROOT, 'test-results', 'api-server-nodb.log') },
      )
    })

    afterAll(async () => {
      await server?.stop()
    })

    it('stays live but answers 503 SERVICE_UNAVAILABLE with details.checks', async () => {
      const api = createClient({ baseUrl: server.baseUrl })
      expect((await api.get('/api/health')).status).toBe(200)
      const res = await api.get('/api/ready')
      expectApiError(res, 503, 'SERVICE_UNAVAILABLE')
      expect(res.body.data.details.checks).toMatchObject({ db: 'down', migrations: 'unknown' })
    })
  })
})
