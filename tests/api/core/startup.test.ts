/**
 * Startup checks of the built server: production refuses a non-loopback bind, an invalid environment and a port
 * that is already in use (fatal log line, exit 1).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { apiBaseUrl, createClient, REPO_ROOT, serverEnv, startTestServer } from '../_harness'

describe('startup checks', () => {
  it('refuses to listen on a public interface in production', async () => {
    const logFile = join(REPO_ROOT, 'test-results', 'api-server-public-bind.log')
    await expect(startTestServer(serverEnv(), { logFile, host: '0.0.0.0' })).rejects.toThrow(/exited early \(code 1\)/)
    const log = readFileSync(logFile, 'utf8')
    expect(log).toContain('"level":"fatal"')
    expect(log).toContain('NITRO_HOST=127.0.0.1')
    expect(log).not.toContain('Listening on')
  })

  it('exits with a fatal log when the port is already in use', async () => {
    const logFile = join(REPO_ROOT, 'test-results', 'api-server-port-in-use.log')
    const port = Number(new URL(apiBaseUrl()).port)
    await expect(startTestServer(serverEnv(), { logFile, port })).rejects.toThrow(/exited early \(code 1\)/)
    const log = readFileSync(logFile, 'utf8')
    expect(log).toContain('"level":"fatal"')
    expect(log).toContain('already in use')
    // The server that owns the port keeps working.
    expect((await createClient().get('/api/health')).status).toBe(200)
  })

  it('refuses to start with an invalid environment and names the variable', async () => {
    const logFile = join(REPO_ROOT, 'test-results', 'api-server-bad-env.log')
    const env = { ...serverEnv(), APP_SECRET: 'change-me-please-this-is-a-placeholder-value' }
    await expect(startTestServer(env, { logFile })).rejects.toThrow(/exited early \(code 1\)/)
    const log = readFileSync(logFile, 'utf8')
    expect(log).toContain('APP_SECRET')
    expect(log).not.toContain(env.APP_SECRET)
  })
})
