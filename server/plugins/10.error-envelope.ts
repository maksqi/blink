/**
 * Error envelope for `/api/**` (server-core, docs/API.md §1.3). Nitro runs `error` hooks synchronously right before
 * its error handler, so this rewrites validation errors, unknown routes and unexpected failures into
 * `{ statusCode, statusMessage, data: { code, details? } }` and logs unexpected failures (redacted, with the request
 * id) instead of leaking their messages. Errors from `apiError()` pass unchanged.
 */
import { isError } from 'h3'
import { requestLogger } from '../utils/logger'
import { isApiPath, normalizedPath } from '../utils/request-guards'
import { normalizeApiError } from '../utils/validation'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, context) => {
    const event = context.event
    if (!event || !isError(error)) return
    const path = normalizedPath(event.path)
    if (!isApiPath(path)) return
    const result = normalizeApiError(error)
    if (result.kind === 'internal') {
      requestLogger(event).error('unhandled error', { method: event.method, path, err: result.original })
    }
  })
})
