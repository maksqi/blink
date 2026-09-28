/**
 * Startup checks (server-core). Synchronous, because Nitro v2 does not await async plugins.
 * - The environment must parse (`server/utils/env.ts`); otherwise log every problem and exit 1.
 * - Built servers must listen on loopback (`NITRO_HOST` / `HOST`), unless `ALLOW_PUBLIC_BIND=1`.
 * `nuxt dev` only logs problems so the dev server keeps running.
 */
import { EnvError, env } from '../utils/env'
import { logger } from '../utils/logger'
import { bindAddressProblem } from '../utils/startup'

function fail(message: string): void {
  logger.fatal(message)
  if (!import.meta.dev) process.exit(1)
}

export default defineNitroPlugin(() => {
  try {
    env()
  } catch (error) {
    if (!(error instanceof EnvError)) throw error
    fail(error.message)
    return
  }
  if (import.meta.dev) return
  const problem = bindAddressProblem({
    host: process.env.NITRO_HOST || process.env.HOST,
    allowPublicBind: process.env.ALLOW_PUBLIC_BIND === '1',
  })
  if (problem) fail(problem)
})
