// GET /api/rooms/:id/invites (rooms-backend): owner or co-host; tokens are re-derived, never stored.
import { listInvites } from '../../../../services/invites/invites'
import { requireRoomAccess } from '../../../../services/rooms/rooms'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { room } = await requireRoomAccess(user.id, getRouterParam(event, 'id') ?? '', 'member')
  return { items: await listInvites(room.id) }
})
