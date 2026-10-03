// DELETE /api/admin/invites/:id (admin): revokes an account invite (idempotent). 204; 404 NOT_FOUND.
import { adminActor, routeId } from '../../../services/admin'
import { revokeAccountInvite } from '../../../services/users'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = routeId(getRouterParam(event, 'id'))
  await revokeAccountInvite(id, adminActor(admin, event))
  return sendNoContent(event)
})
