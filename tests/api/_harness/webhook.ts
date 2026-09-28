/**
 * Signs LiveKit webhook bodies the way LiveKit does (docs/TESTING.md §5.5): an `Authorization` JWT whose `sha256`
 * claim is the base64 SHA-256 of the raw body, signed with the server's LiveKit key pair by default.
 *
 *   const body = new WebhookEvent({ event: 'participant_joined', id, room: { name } }).toJsonString()
 *   await api.post('/api/webhooks/livekit', { raw: body, origin: null,
 *     headers: { 'content-type': 'application/webhook+json', authorization: await signWebhook(body) } })
 */
import { createHash } from 'node:crypto'
import { AccessToken } from 'livekit-server-sdk'
import { serverEnv } from './context'

export async function signWebhook(body: string, apiKey?: string, apiSecret?: string): Promise<string> {
  const env = serverEnv()
  const token = new AccessToken(apiKey ?? env.LIVEKIT_API_KEY, apiSecret ?? env.LIVEKIT_API_SECRET)
  token.sha256 = createHash('sha256').update(body).digest('base64')
  return token.toJwt()
}
