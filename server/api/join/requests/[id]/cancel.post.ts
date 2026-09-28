// POST /api/join/requests/:id/cancel (rooms-backend): the request owner withdraws a waiting request. 204 (also when it
// was already decided); anyone else 403 FORBIDDEN.
import { cancelRequest } from '../../../../services/lobby/lobby'

export default defineEventHandler(async (event) => {
  await cancelRequest(event, getRouterParam(event, 'id') ?? '')
  return sendNoContent(event)
})
