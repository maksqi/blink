// DELETE /api/admin/recordings/:id (recording-server): any state; cancels processing and ends an active recording.
import { adminDeleteRecording } from '../../../services/recordings/access'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  await adminDeleteRecording(event, getRouterParam(event, 'id'))
  return null
})
