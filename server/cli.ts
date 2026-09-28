/**
 * blinq operator CLI. Runs before the server starts (Nitro v2 does not await async plugins) and for recovery.
 *
 *   cli migrate                    apply database migrations (advisory lock, idempotent)
 *   cli bootstrap                  create the first admin from ADMIN_EMAIL / ADMIN_PASSWORD (only once, ever)
 *   cli reset-password <email>     set a new password read from stdin, revoke sessions, clear throttling, audit
 *
 * Bundled to .output/server/cli.mjs by scripts/build-cli.mjs (run it with the production environment, e.g.
 * `node --env-file=.env .output/server/cli.mjs bootstrap`). In development: `pnpm cli <command>`.
 * Exit codes: 0 success, 1 failure, 2 usage, 130 aborted prompt.
 */
import { closeDb } from './database/client'
import { runMigrations } from './database/migrate'
import { EnvError, env } from './utils/env'

const USAGE = 'Usage: cli <migrate | bootstrap | reset-password <email>>'

async function run(argv: string[]): Promise<number> {
  const [command, ...args] = argv
  switch (command) {
    case 'migrate': {
      await runMigrations(env().DATABASE_URL)
      console.log('[blinq] migrations applied')
      return 0
    }
    case 'bootstrap': {
      // Loaded lazily so `migrate` never needs the argon2 native addon.
      const { runBootstrap } = await import('./services/session/bootstrap')
      return runBootstrap()
    }
    case 'reset-password': {
      const email = args[0]
      if (!email || args.length > 1) {
        // The password is read from stdin only; refusing extra arguments keeps it out of argv.
        console.error(USAGE)
        return 2
      }
      const { runResetPassword } = await import('./services/session/reset-password')
      return runResetPassword(email)
    }
    default:
      console.error(USAGE)
      return 2
  }
}

async function main(argv: string[]): Promise<number> {
  try {
    return await run(argv)
  } finally {
    await closeDb()
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
