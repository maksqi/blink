// POST /api/calls/:roomId/lobby/admit-all (rooms-backend): lobby.admit — admits waiting requests in order while there
// is capacity. { admitted }.
import { auditCall } from '../../../../services/calls/actions'
import { authorizeCall } from '../../../../services/calls/authorize'
import { admitAll } from '../../../../services/lobby/lobby'

export default defineEventHandler(async (event) => {
  const ctx = await authorizeCall(event, getRouterParam(event, 'roomId') ?? '', 'lobby.admit')
  const admitted = await admitAll(ctx.caller)
  await auditCall(event, ctx, 'lobby.admit_all', { admitted })
  return { admitted }
})
