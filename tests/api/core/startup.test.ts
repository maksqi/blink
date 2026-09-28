/**
 * Startup checks of the built server: production refuses a non-loopback bind and an invalid environment
 * (fatal log line, exit 1) before it ever listens.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT, serverEnv, startTestServer } from '../_harness'

describe('startup checks', () => {
  it('refuses to listen on a public interface in production', async () => {
    const logFile = join(REPO_ROOT, 'test-results', 'api-server-public-bind.log')
    await expect(startTestServer(serverEnv(), { logFile, host: '0.0.0.0' })).rejects.toThrow(/exited early \(code 1\)/)
    const log = readFileSync(logFile, 'utf8')
    expect(log).toContain('"level":"fatal"')
    expect(log).toContain('NITRO_HOST=127.0.0.1')
    expect(log).not.toContain('Listening on')
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
