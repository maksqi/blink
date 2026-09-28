/**
 * Vitest globalSetup for API tests (server-core, docs/TESTING.md §5.1). Once per `pnpm test:api`:
 * 1. builds the test server (`pnpm build:test`, under the machine lock; `API_TEST_SKIP_BUILD=1` reuses `.output`),
 * 2. recreates the test database (`<worktree db>_test_api`) and migrates it with the bundled CLI,
 * 3. starts `.output/server/index.mjs` on a free loopback port with an explicit environment (fake LiveKit,
 *    Mailpit SMTP, PUBLIC_URL = its own origin),
 * 4. provides `apiBaseUrl`, `testDatabaseUrl`, `databaseAdminUrl`, `mailpitUrl`, `serverEnv`, `serverLogFile`,
 * and on teardown stops the server and drops the database. Logs go to `test-results/api-*.log`.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestProject } from 'vitest/node'
import { dropDatabase, recreateDatabase } from './db-admin'
import { buildServerEnv, mailpitApiUrl, REPO_ROOT, resolveDatabaseUrls } from './environment'
import { buildTestServer, runCli, startTestServer } from './processes'

export default async function setup(project: TestProject) {
  const logDir = join(REPO_ROOT, 'test-results')
  mkdirSync(logDir, { recursive: true })
  const dataDir = mkdtempSync(join(tmpdir(), 'blinq-api-'))

  await buildTestServer(join(logDir, 'api-build.log'))

  const urls = resolveDatabaseUrls()
  try {
    await recreateDatabase(urls.admin, urls.testName)
  } catch (error) {
    const where = new URL(urls.admin).host
    throw new Error(`Cannot prepare the test database on ${where} (is the dev stack running? pnpm dev:deps): ${String(error)}`, {
      cause: error,
    })
  }
  const env = buildServerEnv({
    databaseUrl: urls.test,
    recordingsDir: join(dataDir, 'recordings'),
    workDir: join(dataDir, 'work'),
  })
  const migrated = await runCli(['migrate'], { ...env, PUBLIC_URL: 'http://127.0.0.1' })
  if (migrated.code !== 0) throw new Error(`Migrating the test database failed:\n${migrated.stderr || migrated.stdout}`)

  const logFile = join(logDir, 'api-server.log')
  rmSync(logFile, { force: true })
  const server = await startTestServer(env, { logFile })

  project.provide('apiBaseUrl', server.baseUrl)
  project.provide('testDatabaseUrl', urls.test)
  project.provide('databaseAdminUrl', urls.admin)
  project.provide('mailpitUrl', mailpitApiUrl())
  project.provide('serverEnv', { ...env, PUBLIC_URL: server.baseUrl })
  project.provide('serverLogFile', logFile)

  return async () => {
    await server.stop()
    await dropDatabase(urls.admin, urls.testName)
    rmSync(dataDir, { recursive: true, force: true })
  }
}
