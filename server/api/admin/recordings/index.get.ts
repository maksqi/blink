// GET /api/admin/recordings (recording-server): every recording; `q` matches room name, creator name or email.
import { paginationQuerySchema } from '#shared/schemas/common'
import { listAllRecordings } from '../../../services/recordings/access'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const query = await getValidatedQuery(event, paginationQuerySchema.parse)
  return listAllRecordings(query)
})
