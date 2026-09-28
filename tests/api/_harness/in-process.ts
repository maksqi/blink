/**
 * In-process access to server modules against the test database, for service-level integration tests.
 *
 * - `useServerEnvInProcess()`: call at the top of a test file; makes `env()` and `useDb()` in this worker use the
 *   test server's environment (registers beforeAll/afterAll; closes the pool afterwards).
 * - `fakeEvent({ cookie, ip, method, path, headers })`: an h3 event from a loopback socket for helpers that take
 *   one (`getAuth`, `requireUser`, `resolveCaller`, `audit`, `getClientIp`). Response headers can be read from
 *   `event.node.res.getHeader(...)`.
 * Caches (sessions, settings, limiters) in this worker are separate from the running server's.
 */
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent, type H3Event } from 'h3'
import { afterAll, beforeAll, vi } from 'vitest'
import { closeDb } from '../../../server/database/client'
import { resetEnvCache } from '../../../server/utils/env'
import { serverEnv } from './context'

export function useServerEnvInProcess(): void {
  beforeAll(() => {
    for (const [key, value] of Object.entries(serverEnv())) vi.stubEnv(key, value)
    resetEnvCache()
  })
  afterAll(async () => {
    await closeDb()
    vi.unstubAllEnvs()
    resetEnvCache()
  })
}

export function fakeEvent(
  options: { cookie?: string; ip?: string; method?: string; path?: string; headers?: Record<string, string> } = {},
): H3Event {
  const socket = new Socket()
  Object.defineProperty(socket, 'remoteAddress', { value: '127.0.0.1' })
  const req = new IncomingMessage(socket)
  req.method = options.method ?? 'GET'
  req.url = options.path ?? '/api/test'
  req.headers = Object.fromEntries(Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
  if (options.cookie) req.headers.cookie = options.cookie
  if (options.ip) req.headers['x-forwarded-for'] = options.ip
  return createEvent(req, new ServerResponse(req))
}
