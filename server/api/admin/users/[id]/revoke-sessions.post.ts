// POST /api/admin/users/:id/revoke-sessions (admin): signs the user out everywhere (live calls end). 204.
import { adminActor, routeId } from '../../../../services/admin'
import { revokeUserSessions } from '../../../../services/users'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = routeId(getRouterParam(event, 'id'))
  await revokeUserSessions(id, adminActor(admin, event))
  return sendNoContent(event)
})
