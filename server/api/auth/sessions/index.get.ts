// GET /api/auth/sessions (auth, docs/API.md §3): the caller's active sessions.
import { listOwnSessions } from '../../../services/auth/sessions'
import { requireUser } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return { items: await listOwnSessions(event) }
})
