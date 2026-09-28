// GET /api/auth/me (auth, docs/API.md §3): the signed-in user, or `{ user: null }` (200) when anonymous.
import type { MeResponse } from '#shared/schemas/auth'
import { getAuth } from '../../utils/auth'

export default defineEventHandler(async (event): Promise<MeResponse> => {
  const { user } = await getAuth(event)
  return { user }
})
