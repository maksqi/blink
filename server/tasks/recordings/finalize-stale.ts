// recordings:finalize-stale (recording-server), every 2 minutes (nuxt.config.ts): finalizes recordings whose uploader
// is gone and re-enqueues `processing` rows missing from the queue. Logic: server/services/recordings/tasks.ts.
import { finalizeStale } from '../../services/recordings/tasks'
import { logger } from '../../utils/logger'

export default defineTask({
  meta: { name: 'recordings:finalize-stale', description: 'Finalize recordings whose uploader disconnected or stopped sending chunks' },
  async run() {
    const result = await finalizeStale()
    if (result.finalized || result.requeued) logger.info('recordings:finalize-stale finished', { ...result })
    return { result }
  },
})
