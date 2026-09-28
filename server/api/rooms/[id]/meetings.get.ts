// GET /api/rooms/:id/meetings (rooms-backend): owner or co-host; meeting history, newest first.
import { paginationQuerySchema } from '#shared/schemas/common'
import { listMeetings } from '../../../services/meetings/meetings'
import { requireRoomAccess } from '../../../services/rooms/rooms'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { room } = await requireRoomAccess(user.id, getRouterParam(event, 'id') ?? '', 'member')
  const query = await getValidatedQuery(event, paginationQuerySchema.parse)
  return listMeetings(room.id, query)
})
