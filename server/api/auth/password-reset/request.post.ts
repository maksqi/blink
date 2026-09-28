// POST /api/auth/password-reset/request (auth, docs/API.md §3): always 202 (no enumeration); 503 without SMTP.
import { passwordResetRequestSchema } from '#shared/schemas/auth'
import { limitAuthRequest } from '../../../services/auth/limits'
import { requestPasswordReset } from '../../../services/auth/password-reset'

export default defineEventHandler(async (event) => {
  limitAuthRequest(event)
  const { email } = await readValidatedBody(event, passwordResetRequestSchema.parse)
  await requestPasswordReset(event, email)
  setResponseStatus(event, 202)
  return { ok: true as const }
})
