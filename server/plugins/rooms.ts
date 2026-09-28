/**
 * Rooms plugin (rooms-backend). Synchronous registration only (Nitro v2 does not await async plugins):
 * - `user.revoked` → the user's live call identities are removed (server/services/calls/revocation.ts);
 * - rooms maintenance every minute (stale waiting requests, meetings whose LiveKit room is gone, idle instant
 *   meetings), never overlapping itself. The same work is available as the `rooms:maintenance` task.
 */
import { removeUserFromLiveCalls } from '../services/calls/revocation'
import { runRoomsMaintenance } from '../services/meetings/maintenance'
import { subscribeTo } from '../utils/event-bus'
import { logger } from '../utils/logger'

const MAINTENANCE_INTERVAL_MS = 60_000

export default defineNitroPlugin((nitroApp) => {
  const stopRevocations = subscribeTo('user.revoked', (event) => removeUserFromLiveCalls(event.userId))

  let running = false
  const timer = setInterval(() => {
    if (running) return
    running = true
    runRoomsMaintenance()
      .then((result) => {
        if (result.staleWaiting || result.reconciled || result.archived) logger.info('rooms maintenance', result)
      })
      .catch((error: unknown) => logger.warn('rooms maintenance failed', { err: error }))
      .finally(() => {
        running = false
      })
  }, MAINTENANCE_INTERVAL_MS)
  timer.unref?.()

  nitroApp.hooks.hook('close', () => {
    stopRevocations()
    clearInterval(timer)
  })
})
