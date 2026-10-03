// POST /api/admin/users (admin): creates an account with a temporary password, shown once or emailed. 201.
import { adminCreateUserSchema } from '#shared/schemas/admin'
import { adminActor } from '../../../services/admin'
import { createUserByAdmin } from '../../../services/users'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const body = await readValidatedBody(event, adminCreateUserSchema.parse)
  const created = await createUserByAdmin(body, adminActor(admin, event))
  setResponseStatus(event, 201)
  return created
})
