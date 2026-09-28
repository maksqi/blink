/**
 * Request log: one JSON line per request (method, path without query, status, duration, request id), probes skipped,
 * and no secrets from query strings, cookies or bodies.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { randomToken } from '../../../server/utils/crypto'
import { createClient, createUser, loginAs, serverLogFile } from '../_harness'

type LogRecord = Record<string, unknown>

function records(): LogRecord[] {
  return readFileSync(serverLogFile(), 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as LogRecord)
}

async function logFor(requestId: string | null): Promise<LogRecord> {
  let found: LogRecord | undefined
  await expect
    .poll(() => (found = records().find((r) => r.requestId === requestId && r.msg === 'request')), { timeout: 5_000 })
    .toBeTruthy()
  return found!
}

describe('request log', () => {
  it('logs method, path without query, status, duration and the request id', async () => {
    const res = await createClient().get('/api/config', { query: { page: 2, token: 'query-secret-value' } })
    const record = await logFor(res.headers.get('x-request-id'))
    expect(record).toMatchObject({ level: 'info', method: 'GET', path: '/api/config', status: 200 })
    expect(typeof record.durationMs).toBe('number')
    expect(readFileSync(serverLogFile(), 'utf8')).not.toContain('query-secret-value')
  })

  it('logs requests rejected by middleware', async () => {
    const res = await createClient().post('/api/rooms', { origin: null })
    expect(await logFor(res.headers.get('x-request-id'))).toMatchObject({ method: 'POST', path: '/api/rooms', status: 403 })
  })

  it('skips health and readiness probes', async () => {
    const api = createClient()
    const ids = [(await api.get('/api/health')).headers.get('x-request-id'), (await api.get('/api/ready')).headers.get('x-request-id')]
    const marker = await api.get('/api/config')
    await logFor(marker.headers.get('x-request-id'))
    expect(records().filter((r) => ids.includes(r.requestId as string))).toEqual([])
  })

  it('never writes session tokens, passwords or proofs', async () => {
    const api = await loginAs(await createUser())
    const password = `pw-${randomToken()}`
    const proof = randomToken()
    const res = await api.post('/api/auth/login', { body: { email: 'x@example.test', password, proof } })
    await logFor(res.headers.get('x-request-id'))
    const log = readFileSync(serverLogFile(), 'utf8')
    expect(log).not.toContain(api.session!.token)
    expect(log).not.toContain(password)
    expect(log).not.toContain(proof)
  })
})
