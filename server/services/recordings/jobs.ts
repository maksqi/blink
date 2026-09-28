/**
 * The process-wide recording job queue (concurrency 1) and the boot-time resume of `processing` rows.
 * `recordings:finalize-stale` also re-enqueues `processing` rows every 2 minutes, so a lost queue always recovers.
 */
import { asc, eq } from 'drizzle-orm'
import { useDb } from '../../database/client'
import { recordings } from '../../database/schema'
import { logger } from '../../utils/logger'
import { processRecording } from './processor'
import { createJobQueue, type JobQueue } from './queue'

let shared: JobQueue | undefined

export function recordingQueue(): JobQueue {
  shared ??= createJobQueue(processRecording, {
    onError: (error, id) => logger.error('recording job failed unexpectedly; it will be retried', { recordingId: id, err: error }),
  })
  return shared
}

export function enqueueRecording(id: string): boolean {
  return recordingQueue().enqueue(id)
}

/** Enqueues every `processing` row, oldest first; returns how many were new to the queue. */
export async function resumeProcessing(enqueue: (id: string) => boolean = enqueueRecording): Promise<number> {
  const rows = await useDb()
    .select({ id: recordings.id })
    .from(recordings)
    .where(eq(recordings.status, 'processing'))
    .orderBy(asc(recordings.updatedAt))
  let added = 0
  for (const row of rows) if (enqueue(row.id)) added++
  return added
}
