/**
 * LiveKit webhook intake (rooms-backend, docs/API.md §10). The raw body is verified with `WebhookReceiver` (a JWT in
 * `Authorization` signed with the API key pair whose `sha256` claim covers the body) and deduplicated by event id for
 * 10 minutes in memory (decision).
 *
 * - `verifyWebhook(body, authorization)` → `WebhookEvent`, else 401 `UNAUTHENTICATED`.
 * - `createEventDeduper({ ttlMs, maxEntries, now })`: `claim(id)` is true the first time an id is seen within the TTL;
 *   `release(id)` forgets it again (processing failed, so a retry may run).
 * - `webhookDeduper()`: the process-wide instance.
 */
import { WebhookReceiver, type WebhookEvent } from 'livekit-server-sdk'
import { apiError } from '../../utils/api-error'
import { env } from '../../utils/env'
import { logger } from '../../utils/logger'

export const WEBHOOK_DEDUPE_TTL_MS = 600_000
export const WEBHOOK_DEDUPE_MAX = 10_000

export interface EventDeduper {
  claim(id: string): boolean
  release(id: string): void
  readonly size: number
}

export function createEventDeduper(
  options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {},
): EventDeduper {
  const ttlMs = options.ttlMs ?? WEBHOOK_DEDUPE_TTL_MS
  const maxEntries = options.maxEntries ?? WEBHOOK_DEDUPE_MAX
  const now = options.now ?? Date.now
  // Insertion order equals expiry order, so expired entries are always at the front.
  const seen = new Map<string, number>()
  const sweep = (at: number) => {
    for (const [id, expiresAt] of seen) {
      if (expiresAt > at && seen.size <= maxEntries) break
      seen.delete(id)
    }
  }
  return {
    claim(id) {
      const at = now()
      sweep(at)
      if (seen.has(id)) return false
      seen.set(id, at + ttlMs)
      sweep(at)
      return true
    },
    release(id) {
      seen.delete(id)
    },
    get size() {
      return seen.size
    },
  }
}

let shared: EventDeduper | undefined

export function webhookDeduper(): EventDeduper {
  shared ??= createEventDeduper()
  return shared
}

let receiver: { key: string; instance: WebhookReceiver } | undefined

export async function verifyWebhook(body: string, authorization: string | undefined): Promise<WebhookEvent> {
  const config = env()
  const key = `${config.LIVEKIT_API_KEY}:${config.LIVEKIT_API_SECRET}`
  if (receiver?.key !== key) receiver = { key, instance: new WebhookReceiver(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET) }
  if (!authorization) throw apiError('UNAUTHENTICATED', 401)
  try {
    return await receiver.instance.receive(body, authorization)
  } catch (error) {
    logger.warn('LiveKit webhook rejected', { reason: error instanceof Error ? error.message : 'invalid' })
    throw apiError('UNAUTHENTICATED', 401)
  }
}
