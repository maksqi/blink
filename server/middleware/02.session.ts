/**
 * Session resolution (server-core): resolves the session cookie once for every `/api/**` request, so handlers and
 * the password-change guard share the result (`getAuth(event)`). Probes and the LiveKit webhook never touch the
 * session store.
 */
import { getAuth } from '../utils/auth'
import { isApiPath, isCsrfExempt, isProbePath, normalizedPath } from '../utils/request-guards'

export default defineEventHandler(async (event) => {
  const path = normalizedPath(event.path)
  if (!isApiPath(path) || isProbePath(path) || isCsrfExempt(event.method, path)) return
  await getAuth(event)
})
