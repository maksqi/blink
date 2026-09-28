/**
 * Per-request context set by server-core middleware (server/middleware/00.request-id.ts).
 *
 * - `event.context.requestId`: random id per request, echoed as `X-Request-Id`. Never taken from the client.
 * - `event.context.requestStartedAt`: `performance.now()` at the start of the request (request log duration).
 * - `newRequestId()`: 16 base64url characters.
 */
import { randomToken } from './crypto'

declare module 'h3' {
  interface H3EventContext {
    requestId?: string
    requestStartedAt?: number
  }
}

export function newRequestId(): string {
  return randomToken(12)
}
