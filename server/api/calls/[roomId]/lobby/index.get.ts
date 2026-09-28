// GET /api/calls/:roomId/lobby (rooms-backend): lobby.view — waiting requests, oldest first.
import { authorizeCall } from '../../../../services/calls/authorize'
import { listLobby } from '../../../../services/lobby/lobby'

export default defineEventHandler(async (event) => {
  const ctx = await authorizeCall(event, getRouterParam(event, 'roomId') ?? '', 'lobby.view')
  return { items: await listLobby(ctx.room.id, ctx.meetingId) }
})
