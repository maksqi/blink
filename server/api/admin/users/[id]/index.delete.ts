// DELETE /api/admin/users/:id (admin): ends the user's live meetings, deletes their recording files, then the account.
// 204; 409 CONFLICT `self` or `last_admin`; 404 NOT_FOUND.
import { adminActor, deleteUserByAdmin, routeId } from '../../../../services/admin'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = routeId(getRouterParam(event, 'id'))
  await deleteUserByAdmin(id, adminActor(admin, event))
  return sendNoContent(event)
})
