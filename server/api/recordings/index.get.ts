// GET /api/recordings (recording-server): own recordings and recordings of rooms the caller owns, newest first.
import { paginationQuerySchema } from '#shared/schemas/common'
import { listRecordings } from '../../services/recordings/access'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const query = await getValidatedQuery(event, paginationQuerySchema.parse)
  return listRecordings(user, query)
})
