// POST /api/auth/verify-email (auth, docs/API.md §3): single-use token from the `/verify-email#<token>` link.
import { tokenBodySchema } from '#shared/schemas/auth'
import { limitAuthRequest } from '../../services/auth/limits'
import { verifyEmail } from '../../services/auth/verification'

export default defineEventHandler(async (event) => {
  limitAuthRequest(event)
  const { token } = await readValidatedBody(event, tokenBodySchema.parse)
  await verifyEmail(event, token)
  return { ok: true as const }
})
