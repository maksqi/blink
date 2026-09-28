// POST /api/auth/register (auth, docs/API.md §3): 201 + cookie in open mode, 202 in domain mode, 403 when closed.
import { registerSchema } from '#shared/schemas/auth'
import { limitAuthRequest } from '../../services/auth/limits'
import { register } from '../../services/auth/registration'

export default defineEventHandler(async (event) => {
  limitAuthRequest(event)
  const body = await readValidatedBody(event, registerSchema.parse)
  const outcome = await register(event, body)
  if (outcome.kind === 'created') {
    setResponseStatus(event, 201)
    return { user: outcome.user }
  }
  setResponseStatus(event, 202)
  return { verificationRequired: true as const }
})
