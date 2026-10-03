// DELETE /api/admin/rooms/:id (admin): soft-deletes the room and ends a live meeting. 204; 404 NOT_FOUND.
import { adminActor, deleteRoomByAdmin, routeId } from '../../../../services/admin'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = routeId(getRouterParam(event, 'id'))
  await deleteRoomByAdmin(id, adminActor(admin, event))
  return sendNoContent(event)
})
