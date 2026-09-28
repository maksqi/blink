// rooms:maintenance (rooms-backend): stale waiting requests (1 h), meetings whose LiveKit room is gone, idle instant
// meetings (24 h). server/plugins/rooms.ts runs the same work every minute; this task allows a manual run.
import { runRoomsMaintenance } from '../../services/meetings/maintenance'
import { logger } from '../../utils/logger'

export default defineTask({
  meta: { name: 'rooms:maintenance', description: 'Stale waiting requests, stale meetings, idle instant meetings' },
  async run() {
    const result = await runRoomsMaintenance()
    logger.info('rooms:maintenance finished', result)
    return { result }
  },
})
