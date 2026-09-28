// PATCH /api/me (auth, docs/API.md §4): update the own display name.
import { updateMeSchema } from '#shared/schemas/auth'
import { updateProfile } from '../services/auth/profile'
import { requireUser } from '../utils/auth'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const body = await readValidatedBody(event, updateMeSchema.parse)
  return { user: await updateProfile(event, body) }
})
