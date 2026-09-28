/**
 * Request log (server-core): one line per request when the response closes: method, path without query, status,
 * duration and request id. Registered this early so requests rejected by later middleware (CSRF, guard) are logged
 * too. Health and readiness probes are skipped.
 */
import { requestLogger } from '../utils/logger'
import { isProbePath, normalizedPath } from '../utils/request-guards'

export default defineEventHandler((event) => {
  const path = normalizedPath(event.path)
  if (isProbePath(path)) return
  const startedAt = event.context.requestStartedAt ?? performance.now()
  const res = event.node.res
  res.once('close', () => {
    const fields = {
      method: event.method,
      path,
      status: res.statusCode,
      durationMs: Math.round(performance.now() - startedAt),
      ...(res.writableFinished ? {} : { aborted: true }),
    }
    const log = requestLogger(event)
    if (res.statusCode >= 500) log.warn('request', fields)
    else log.info('request', fields)
  })
})
