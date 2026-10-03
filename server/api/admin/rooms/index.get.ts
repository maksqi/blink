// GET /api/admin/rooms (admin): every room with live state and participant counts (metadata only).
import { paginationQuerySchema } from '#shared/schemas/common'
import { listAdminRooms } from '../../../services/admin'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const query = await getValidatedQuery(event, paginationQuerySchema.parse)
  return listAdminRooms(query)
})
