// GET /api/recordings/:id/file (recording-server, docs/API.md §8): the decrypted MP4, with Range support.
import { serveRecordingFile } from '../../../services/recordings/serve'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  await serveRecordingFile(event, user, getRouterParam(event, 'id'))
})
