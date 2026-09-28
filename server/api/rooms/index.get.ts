// GET /api/rooms (rooms-backend): rooms the caller owns or co-hosts, newest activity first (docs/API.md §5).
import { paginationQuerySchema } from '#shared/schemas/common'
import { listRooms } from '../../services/rooms/rooms'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const query = await getValidatedQuery(event, paginationQuerySchema.parse)
  return listRooms(user.id, query)
})
