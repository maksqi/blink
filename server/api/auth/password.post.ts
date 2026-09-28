// POST /api/auth/password (auth, docs/API.md §3): change the own password; other sessions are revoked, this one is
// rotated. Exempt from the forced-password-change guard.
import { changePasswordSchema } from '#shared/schemas/auth'
import { changePassword } from '../../services/auth/password-change'
import { requireUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const body = await readValidatedBody(event, changePasswordSchema.parse)
  return { user: await changePassword(event, body) }
})
