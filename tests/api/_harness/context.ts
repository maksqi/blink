/**
 * Values the global setup hands to API test files (`provide` → `inject`). Use the accessors below.
 */
import { inject } from 'vitest'

declare module 'vitest' {
  export interface ProvidedContext {
    /** Origin of the running test server, e.g. http://127.0.0.1:41234 (also its PUBLIC_URL). */
    apiBaseUrl: string
    /** The test database the server uses (factories write here). */
    testDatabaseUrl: string
    /** The same Postgres server's `postgres` database, to create scratch databases. */
    databaseAdminUrl: string
    /** Mailpit HTTP API origin, e.g. http://127.0.0.1:8025. */
    mailpitUrl: string
    /** The complete environment the server runs with (secrets included; test values only). */
    serverEnv: Record<string, string>
    /** File the server writes its JSON logs to. */
    serverLogFile: string
  }
}

export const apiBaseUrl = () => inject('apiBaseUrl')
export const testDatabaseUrl = () => inject('testDatabaseUrl')
export const databaseAdminUrl = () => inject('databaseAdminUrl')
export const mailpitUrl = () => inject('mailpitUrl')
export const serverEnv = () => inject('serverEnv')
export const serverLogFile = () => inject('serverLogFile')
