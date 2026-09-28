// POST /api/calls/:roomId/lobby/:requestId/deny (rooms-backend): lobby.deny; final for the meeting. 204.
import { auditCall } from '../../../../../services/calls/actions'
import { authorizeCall } from '../../../../../services/calls/authorize'
import { denyRequest } from '../../../../../services/lobby/lobby'

export default defineEventHandler(async (event) => {
  const ctx = await authorizeCall(event, getRouterParam(event, 'roomId') ?? '', 'lobby.deny')
  const requestId = getRouterParam(event, 'requestId') ?? ''
  await denyRequest(ctx.caller, requestId)
  await auditCall(event, ctx, 'lobby.deny', { requestId })
  return sendNoContent(event)
})
