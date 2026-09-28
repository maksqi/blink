/**
 * CSRF (server-core, docs/API.md §1.1): mutating requests need `Origin` equal to the origin of `PUBLIC_URL` and
 * `Sec-Fetch-Site: same-origin` when present; otherwise 403 `CSRF_REJECTED`. `POST /api/webhooks/livekit` is exempt.
 */
import { getRequestHeader } from 'h3'
import { apiError } from '../utils/api-error'
import { env } from '../utils/env'
import { csrfRejected, normalizedPath } from '../utils/request-guards'

export default defineEventHandler((event) => {
  const rejected = csrfRejected({
    method: event.method,
    path: normalizedPath(event.path),
    origin: getRequestHeader(event, 'origin'),
    secFetchSite: getRequestHeader(event, 'sec-fetch-site'),
    publicOrigin: env().publicOrigin,
  })
  if (rejected) throw apiError('CSRF_REJECTED', 403)
})
