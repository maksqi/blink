// GET /api/rooms/:id (rooms-backend): owner or co-host; everyone else 404 ROOM_NOT_FOUND.
import { requireRoomAccess, roomDetails } from '../../../services/rooms/rooms'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { room } = await requireRoomAccess(user.id, getRouterParam(event, 'id') ?? '', 'member')
  return { room: await roomDetails(room, user.id) }
})
