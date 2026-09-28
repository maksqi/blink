/**
 * Recording service wiring (recording-server). Synchronous, because Nitro v2 does not await async plugins.
 * - Subscribes to `recording.changed` (rooms-backend publishes it when a meeting ends or the recorder leaves) and
 *   finalizes the recording once its uploader had time to flush (`handleRecordingChanged`).
 * - Resumes `processing` rows a few seconds after boot (the in-memory queue does not survive restarts;
 *   `recordings:finalize-stale` repeats this every 2 minutes).
 * - On shutdown: stops the queue (an interrupted job is retried once after the restart) and pending timers.
 */
import {
  cancelRecordingTimers,
  handleRecordingChanged,
  recordingQueue,
  resumeProcessing,
} from '../services/recordings/api'
import { subscribeTo } from '../utils/event-bus'
import { logger } from '../utils/logger'

const RESUME_DELAY_MS = 3_000

export default defineNitroPlugin((nitroApp) => {
  const unsubscribe = subscribeTo('recording.changed', (event) =>
    handleRecordingChanged(event).catch((error: unknown) =>
      logger.error('handling recording.changed failed', { recordingId: event.recordingId, err: error }),
    ),
  )
  const resume = setTimeout(() => {
    resumeProcessing()
      .then((count) => {
        if (count) logger.info('resumed recording processing', { count })
      })
      .catch((error: unknown) => logger.warn('could not resume recording processing', { err: error }))
  }, RESUME_DELAY_MS)
  resume.unref()

  nitroApp.hooks.hook('close', async () => {
    unsubscribe()
    clearTimeout(resume)
    cancelRecordingTimers()
    await recordingQueue().stop()
  })
})
