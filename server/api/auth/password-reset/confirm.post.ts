// POST /api/auth/password-reset/confirm (auth, docs/API.md §3): single-use token, all sessions revoked, no sign-in.
import { passwordResetConfirmSchema } from '#shared/schemas/auth'
import { limitAuthRequest } from '../../../services/auth/limits'
import { confirmPasswordReset } from '../../../services/auth/password-reset'

export default defineEventHandler(async (event) => {
  limitAuthRequest(event)
  const body = await readValidatedBody(event, passwordResetConfirmSchema.parse)
  await confirmPasswordReset(event, body)
  return { ok: true as const }
})
