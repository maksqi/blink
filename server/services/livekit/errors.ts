/**
 * LiveKit failures inside request handlers (rooms-backend). The database is written first, so a LiveKit error leaves
 * the authoritative state in place; the request answers 503 `SERVICE_UNAVAILABLE` instead of a generic 500, and the
 * next update (or the participant's next join) brings LiveKit in line again.
 */
import { H3Error } from 'h3'
import { apiError } from '../../utils/api-error'
import { logger } from '../../utils/logger'
import { isLivekitNotFound } from './room-service'

export async function withLivekit<T>(operation: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    if (error instanceof H3Error) throw error
    logger.warn('LiveKit call failed', { operation, err: error })
    throw apiError('SERVICE_UNAVAILABLE', 503)
  }
}

/** Runs a participant-level call; a participant that is not connected (not found) is not an error. */
export async function ignoreMissingParticipant(call: () => Promise<unknown>): Promise<void> {
  try {
    await call()
  } catch (error) {
    if (!isLivekitNotFound(error)) throw error
  }
}
