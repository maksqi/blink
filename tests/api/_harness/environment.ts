/**
 * Test environment for the built server (the built server never reads .env; everything is passed explicitly).
 *
 * Database: the base URL comes from `API_TEST_DATABASE_URL`, `DATABASE_URL`, the worktree's `.env`, or the dev
 * stack default; the test database is its name plus `_test_api` (`blinq` → `blinq_test_api`,
 * `blinq_auth` → `blinq_auth_test_api`). LiveKit: `fake://local` unless `API_LIVEKIT_URL` is set. SMTP: Mailpit.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

const DEV_DATABASE_URL = 'postgres://blinq:blinq-dev@127.0.0.1:55432/blinq'

function dotEnv(): Record<string, string | undefined> {
  const file = `${REPO_ROOT}.env`
  return existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}
}

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url)
  parsed.pathname = `/${name}`
  return parsed.toString()
}

export interface DatabaseUrls {
  /** `postgres` database on the same server (create/drop). */
  admin: string
  testName: string
  test: string
}

export function resolveDatabaseUrls(): DatabaseUrls {
  const base = process.env.API_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? dotEnv().DATABASE_URL ?? DEV_DATABASE_URL
  const baseName = decodeURIComponent(new URL(base).pathname.replace(/^\//, '')) || 'blinq'
  const testName = `${baseName.replace(/_test_api$/, '')}_test_api`
  if (!/^[a-z0-9_]+$/.test(testName)) throw new Error(`Unexpected database name: ${testName}`)
  return { admin: withDatabase(base, 'postgres'), testName, test: withDatabase(base, testName) }
}

export function mailpitApiUrl(): string {
  return process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025'
}

/** Everything the server and the bundled CLI need, minus PUBLIC_URL/port (known once the port is chosen). */
export function buildServerEnv(options: { databaseUrl: string; recordingsDir: string; workDir: string }): Record<string, string> {
  return {
    NODE_ENV: 'production',
    TZ: 'UTC',
    DATABASE_URL: options.databaseUrl,
    // Random per run; long enough for env validation and never a placeholder.
    APP_SECRET: `api-test-${randomBytes(24).toString('hex')}`,
    RECORDING_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    LIVEKIT_API_KEY: process.env.API_LIVEKIT_API_KEY ?? 'devkey',
    LIVEKIT_API_SECRET: process.env.API_LIVEKIT_API_SECRET ?? 'dev-only-livekit-secret-not-for-production-000000',
    LIVEKIT_URL: process.env.API_LIVEKIT_URL ?? 'fake://local',
    LIVEKIT_PUBLIC_URL: process.env.API_LIVEKIT_PUBLIC_URL ?? 'ws://127.0.0.1:7880',
    SMTP_HOST: process.env.MAILPIT_SMTP_HOST ?? '127.0.0.1',
    SMTP_PORT: process.env.MAILPIT_SMTP_PORT ?? '1025',
    SMTP_SECURE: 'false',
    SMTP_FROM: 'blinq <no-reply@blinq.test>',
    RECORDINGS_DIR: options.recordingsDir,
    RECORDING_WORK_DIR: options.workDir,
    LOG_LEVEL: 'info',
    LOG_FORMAT: 'json',
    NITRO_SHUTDOWN_TIMEOUT: '3000',
  }
}
