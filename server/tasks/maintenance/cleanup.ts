// maintenance:cleanup (server-core), hourly (nuxt.config.ts): expired sessions, invites, guest sessions, email tokens
// and stale backoff rows. Logic and cutoffs: server/services/session/cleanup.ts.
import { runCleanup } from '../../services/session/cleanup'
import { logger } from '../../utils/logger'

export default defineTask({
  meta: { name: 'maintenance:cleanup', description: 'Expired sessions, invites, guest sessions, email tokens and throttle rows' },
  async run() {
    const result = await runCleanup()
    logger.info('maintenance:cleanup finished', { ...result })
    return { result }
  },
})
