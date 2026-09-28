// POST /api/calls/:roomId/lobby/:requestId/admit (rooms-backend): lobby.admit; 404 NOT_FOUND when the request is no
// longer waiting, 409 ROOM_FULL at capacity. The owner's SSE gets `admitted` with its token. 204.
import { auditCall } from '../../../../../services/calls/actions'
import { authorizeCall } from '../../../../../services/calls/authorize'
import { admitRequest } from '../../../../../services/lobby/lobby'

export default defineEventHandler(async (event) => {
  const ctx = await authorizeCall(event, getRouterParam(event, 'roomId') ?? '', 'lobby.admit')
  const requestId = getRouterParam(event, 'requestId') ?? ''
  await admitRequest(ctx.caller, requestId)
  await auditCall(event, ctx, 'lobby.admit', { requestId })
  return sendNoContent(event)
})
