// POST /api/calls/:roomId/end (rooms-backend): call.end (host) — ends the meeting for everyone (deleteRoom; waiting
// requests get `ended`). 204.
import { endCall } from '../../../services/calls/actions'
import { authorizeCall } from '../../../services/calls/authorize'

export default defineEventHandler(async (event) => {
  const ctx = await authorizeCall(event, getRouterParam(event, 'roomId') ?? '', 'call.end')
  await endCall(event, ctx)
  return sendNoContent(event)
})
