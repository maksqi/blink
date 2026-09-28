// POST /api/auth/invites/preview (auth, docs/API.md §3): what an account invite offers, before accepting it.
import { tokenBodySchema } from '#shared/schemas/auth'
import { previewInvite } from '../../../services/auth/invites'
import { limitAuthRequest } from '../../../services/auth/limits'

export default defineEventHandler(async (event) => {
  limitAuthRequest(event)
  const { token } = await readValidatedBody(event, tokenBodySchema.parse)
  return previewInvite(token)
})
