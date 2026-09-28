// POST /api/webhooks/livekit (rooms-backend): LiveKit events, verified by signature on the raw body (nothing reads the
// body before this handler: the session and CSRF middleware skip this route). Duplicates and rooms of other
// deployments are acknowledged and ignored. 200 { ok: true }; 401 UNAUTHENTICATED for a bad signature.
import { verifyWebhook } from '../../services/livekit/webhook'
import { handleWebhookEvent } from '../../services/meetings/webhooks'

export default defineEventHandler(async (event) => {
  const body = (await readRawBody(event, 'utf8')) ?? ''
  const webhook = await verifyWebhook(body, getRequestHeader(event, 'authorization'))
  await handleWebhookEvent(webhook)
  return { ok: true as const }
})
