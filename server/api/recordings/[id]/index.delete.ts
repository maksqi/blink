// DELETE /api/recordings/:id (recording-server): recorder, room owner or admin; 409 while recording or processing.
import { deleteRecording } from '../../../services/recordings/access'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  await deleteRecording(event, user, getRouterParam(event, 'id'))
  return null
})
