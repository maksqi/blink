// POST /api/admin/rooms/:id/end (admin): ends the live meeting. 204; 404 NOT_FOUND; 409 CONFLICT `not_live`.
import { adminActor, endRoomByAdmin, routeId } from '../../../../services/admin'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = routeId(getRouterParam(event, 'id'))
  await endRoomByAdmin(id, adminActor(admin, event))
  return sendNoContent(event)
})
