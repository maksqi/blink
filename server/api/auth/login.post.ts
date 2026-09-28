// POST /api/auth/login (auth, docs/API.md §3): backoff first, the same 401 for unknown emails and wrong passwords,
// disabled/unverified revealed only after a correct password, session rotated and cookie set.
import { loginSchema } from '#shared/schemas/auth'
import { loginWithPassword } from '../../services/auth/login'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, loginSchema.parse)
  return { user: await loginWithPassword(event, body) }
})
