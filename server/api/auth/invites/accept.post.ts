// POST /api/auth/invites/accept (auth, docs/API.md §3): creates the account (single-use invite) and signs it in.
import { acceptInviteSchema } from '#shared/schemas/auth'
import { acceptInvite } from '../../../services/auth/invites'
import { limitAuthRequest } from '../../../services/auth/limits'

export default defineEventHandler(async (event) => {
  limitAuthRequest(event)
  const body = await readValidatedBody(event, acceptInviteSchema.parse)
  const user = await acceptInvite(event, body)
  setResponseStatus(event, 201)
  return { user }
})
