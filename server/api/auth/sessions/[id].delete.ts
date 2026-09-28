// DELETE /api/auth/sessions/:id (auth, docs/API.md §3): revoke one of the caller's own sessions (204).
import { revokeOwnSession } from '../../../services/auth/sessions'
import { requireUser } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  await revokeOwnSession(event, getRouterParam(event, 'id') ?? '')
  return null
})
