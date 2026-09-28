// GET /api/recordings/:id (recording-server): recorder, room owner or admin; anyone else 404.
import { getRecordingForUser } from '../../../services/recordings/access'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  return getRecordingForUser(user, getRouterParam(event, 'id'))
})
