// DELETE /api/rooms/:id/cohosts/:userId (rooms-backend): owner only; 404 NOT_FOUND when the user is no co-host. 204.
import { audit } from '../../../../services/audit/audit'
import { isUuid } from '../../../../services/rooms/queries'
import { removeCohost, requireRoomAccess } from '../../../../services/rooms/rooms'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { room } = await requireRoomAccess(user.id, getRouterParam(event, 'id') ?? '', 'owner')
  const userId = getRouterParam(event, 'userId')
  if (!isUuid(userId)) throw apiError('NOT_FOUND', 404)
  await removeCohost(room, userId)
  await audit(event, { action: 'room.cohost_removed', targetType: 'room', targetId: room.id, details: { userId } })
  return sendNoContent(event)
})
