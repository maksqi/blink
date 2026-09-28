/**
 * API test harness (server-core). Import everything from here: `import { createClient, createUser } from '../_harness'`.
 *
 * - context: `apiBaseUrl()`, `testDatabaseUrl()`, `databaseAdminUrl()`, `mailpitUrl()`, `serverEnv()`, `serverLogFile()`
 * - client: `createClient()`, `ApiClient`, `uniqueIp()`, `expectApiError(res, status, code)`
 * - database: `testDb()`, `createScratchDatabase(label)`
 * - factories: `createUser`, `createAdmin`, `createSession`, `loginAs`, `createRoom`, `createRoomInvite`, `createInvite`,
 *   `createMeeting`, `createGuestSession`, `createParticipant`, `uniqueEmail`, `uniqueName`, `randomIdentity`
 * - mail: `waitForMessage`, `expectNoMessage`, `searchMessages`, `listMessages`, `getMessage`, `deleteMessages`,
 *   `extractFragmentToken`
 * - LiveKit: `signWebhook(body)`
 * - processes: `startTestServer(env, { logFile })`, `runCli(args, env, stdin)`, `REPO_ROOT`
 * - in-process service tests: `useServerEnvInProcess()`, `fakeEvent({ cookie, ip })`
 * Rules (docs/TESTING.md §5.2): unique data per test, own IP per client, restore changed settings in afterEach, and
 * age rows instead of moving the server clock.
 */
export * from './client'
export * from './context'
export * from './database'
export * from './factories'
export * from './in-process'
export * from './mailpit'
export * from './webhook'
export { REPO_ROOT } from './environment'
export { runCli, startTestServer, type CliResult, type TestServer } from './processes'
