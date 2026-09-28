/**
 * blinq operator CLI. Runs before the server starts (Nitro v2 does not await async plugins) and for recovery.
 *
 *   cli migrate                    apply database migrations (advisory lock, idempotent)
 *   cli bootstrap                  create the first admin from ADMIN_EMAIL / ADMIN_PASSWORD (only once, ever)
 *   cli reset-password <email>     set a new password read from stdin, revoke sessions, clear throttling, audit
 *
 * Bundled to .output/server/cli.mjs by scripts/build-cli.mjs. In development: `pnpm cli <command>`.
 */
import { runMigrations } from './database/migrate'
import { EnvError, env } from './utils/env'

const USAGE = 'Usage: cli <migrate | bootstrap | reset-password <email>>'

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv
  switch (command) {
    case 'migrate': {
      await runMigrations(env().DATABASE_URL)
      console.log('[blinq] migrations applied')
      return 0
    }
    case 'bootstrap': {
      // Implemented by server-core (Stage 01, W0b): server/services/session/bootstrap.ts
      const { runBootstrap } = await import('./services/session/bootstrap')
      return runBootstrap()
    }
    case 'reset-password': {
      const email = args[0]
      if (!email) {
        console.error(USAGE)
        return 2
      }
      // Implemented by server-core (Stage 01, W0b): server/services/session/reset-password.ts
      const { runResetPassword } = await import('./services/session/reset-password')
      return runResetPassword(email)
    }
    default:
      console.error(USAGE)
      return 2
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    if (error instanceof EnvError) {
      console.error(`[blinq] ${error.message}`)
    } else {
      console.error('[blinq] command failed:', error instanceof Error ? error.message : error)
    }
    process.exit(1)
  })
