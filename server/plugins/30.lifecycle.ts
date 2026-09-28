/**
 * Process lifecycle (server-core).
 * - Evicts cached sessions of users revoked through the event bus (`user.revoked`).
 * - Precomputes the argon2 dummy hash (fire and forget), so the first unknown-email login costs the same as any
 *   other. Importing password.ts here also makes Nitro trace @node-rs/argon2 into .output/server/node_modules,
 *   which the bundled CLI (`.output/server/cli.mjs`) resolves at runtime.
 * - On shutdown: closes open SSE streams and the database pool.
 */
import { closeDb } from '../database/client'
import { watchUserRevocations } from '../services/session/sessions'
import { logger } from '../utils/logger'
import { warmUpPasswordHashing } from '../utils/password'
import { closeAllSseStreams } from '../utils/sse'

export default defineNitroPlugin((nitroApp) => {
  const stopWatching = watchUserRevocations()
  warmUpPasswordHashing().catch((error: unknown) => logger.error('argon2 warm-up failed', { err: error }))
  nitroApp.hooks.hook('close', async () => {
    stopWatching()
    closeAllSseStreams()
    await closeDb()
  })
})
