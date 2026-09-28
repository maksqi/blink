/**
 * Request id (server-core): a fresh random id per request in `event.context.requestId` and the `X-Request-Id`
 * response header. A client-sent `X-Request-Id` is ignored. Also marks every `/api/**` response `no-store`
 * (docs/API.md §1).
 */
import { setResponseHeader } from 'h3'
import { newRequestId } from '../utils/request-context'
import { isApiPath, normalizedPath } from '../utils/request-guards'

export default defineEventHandler((event) => {
  const requestId = newRequestId()
  event.context.requestId = requestId
  event.context.requestStartedAt = performance.now()
  setResponseHeader(event, 'X-Request-Id', requestId)
  if (isApiPath(normalizedPath(event.path))) setResponseHeader(event, 'Cache-Control', 'no-store')
})
