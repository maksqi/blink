// POST /api/auth/logout (auth, docs/API.md §3): 204, session revoked, cookie cleared. Exempt from the password guard.
import { logout } from '../../services/auth/sessions'
import { requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  await logout(event)
  return null
})
