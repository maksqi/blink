// DELETE /api/rooms/:id (rooms-backend): owner only; soft delete, a live meeting is ended. 204.
import { audit } from '../../../services/audit/audit'
import { requireRoomAccess, softDeleteRoom } from '../../../services/rooms/rooms'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { room } = await requireRoomAccess(user.id, getRouterParam(event, 'id') ?? '', 'owner')
  await softDeleteRoom(room.id)
  await audit(event, { action: 'room.deleted', targetType: 'room', targetId: room.id })
  return sendNoContent(event)
})
