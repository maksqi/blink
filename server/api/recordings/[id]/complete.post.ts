// POST /api/recordings/:id/complete (recording-server, docs/API.md §8): the recorder, after the last chunk.
import { completeRecordingSchema } from '#shared/schemas/recordings'
import { completeRecording } from '../../../services/recordings/lifecycle'
import { isRecordingId } from '../../../services/recordings/storage'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = getRouterParam(event, 'id')
  if (!isRecordingId(id)) throw apiError('FORBIDDEN', 403)
  const input = await readValidatedBody(event, completeRecordingSchema.parse)
  const result = await completeRecording(user, id, input)
  setResponseStatus(event, 202)
  return result
})
