/**
 * Forced password change guard (server-core, docs/API.md §1.1): while the signed-in user has `mustChangePassword`,
 * every `/api/**` route answers 403 `AUTH_PASSWORD_CHANGE_REQUIRED` except GET /api/auth/me, POST /api/auth/password,
 * POST /api/auth/logout, GET /api/config, GET /api/health and GET /api/ready.
 */
import { apiError } from '../utils/api-error'
import { getAuth } from '../utils/auth'
import { isApiPath, isCsrfExempt, normalizedPath, passwordChangeExempt } from '../utils/request-guards'

export default defineEventHandler(async (event) => {
  const path = normalizedPath(event.path)
  if (!isApiPath(path) || passwordChangeExempt(event.method, path) || isCsrfExempt(event.method, path)) return
  const { user } = await getAuth(event)
  if (user?.mustChangePassword) throw apiError('AUTH_PASSWORD_CHANGE_REQUIRED', 403)
})
