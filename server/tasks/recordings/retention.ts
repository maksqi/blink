// recordings:retention (recording-server), daily (nuxt.config.ts): deletes expired recordings, old failed and local
// rows and orphaned files. Logic: server/services/recordings/tasks.ts.
import { applyRetention } from '../../services/recordings/tasks'
import { logger } from '../../utils/logger'

export default defineTask({
  meta: { name: 'recordings:retention', description: 'Delete recordings past their retention date' },
  async run() {
    const result = await applyRetention()
    logger.info('recordings:retention finished', { ...result })
    return { result }
  },
})
