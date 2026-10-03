// PATCH /api/admin/users/:id (admin): name, role, disabled. Disabling revokes sessions (live calls end), a role change
// rotates them; the last enabled admin stays (409 CONFLICT `last_admin`), admins cannot disable themselves (`self`).
import { adminUpdateUserSchema } from '#shared/schemas/admin'
import { adminActor, routeId } from '../../../../services/admin'
import { updateUserByAdmin } from '../../../../services/users'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = routeId(getRouterParam(event, 'id'))
  const patch = await readValidatedBody(event, adminUpdateUserSchema.parse)
  return { user: await updateUserByAdmin(id, patch, adminActor(admin, event)) }
})
