// GET /api/admin/rooms/:id/meetings (admin): meeting history (start, end, peak), newest first. 404 NOT_FOUND.
import { paginationQuerySchema } from '#shared/schemas/common'
import { listAdminRoomMeetings, routeId } from '../../../../services/admin'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = routeId(getRouterParam(event, 'id'))
  const query = await getValidatedQuery(event, paginationQuerySchema.parse)
  return listAdminRoomMeetings(id, query)
})
