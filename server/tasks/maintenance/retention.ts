// maintenance:retention (server-core), daily (nuxt.config.ts): IP retention (privacy.ipRetentionDays) and audit
// retention (audit.retentionDays). Logic and cutoffs: server/services/audit/retention.ts.
import { runRetention } from '../../services/audit/retention'
import { logger } from '../../utils/logger'

export default defineTask({
  meta: { name: 'maintenance:retention', description: 'IP address and audit log retention' },
  async run() {
    const result = await runRetention()
    logger.info('maintenance:retention finished', { ...result })
    return { result }
  },
})
