/**
 * Listen failures (server-core). Nitro's node-server traps uncaught exceptions without exiting, so a port that is
 * already in use would leave a process that serves nothing (while a stale server keeps answering) and still runs
 * scheduled tasks. Plugins run before `listen()`, so this handler is in place in time: log a fatal line and exit 1.
 */
import { logger } from '../utils/logger'
import { listenErrorMessage } from '../utils/startup'

export default defineNitroPlugin(() => {
  if (import.meta.dev) return
  process.on('uncaughtException', (error) => {
    const message = listenErrorMessage(error)
    if (!message) return
    logger.fatal(message)
    process.exit(1)
  })
})
