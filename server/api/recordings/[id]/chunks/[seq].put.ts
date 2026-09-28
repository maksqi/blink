// PUT /api/recordings/:id/chunks/:seq (recording-server, docs/API.md §8). The service streams the raw body:
// nothing may read it before (no readBody/readRawBody here).
import { ingestChunk } from '../../../../services/recordings/ingest'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  await ingestChunk(event, user, getRouterParam(event, 'id'), getRouterParam(event, 'seq'))
  return null
})
