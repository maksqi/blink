// GET /api/calls/:roomId/participants (rooms-backend): any caller (decision) — the live roster with allowances.
import { listParticipants } from '../../../../services/calls/actions'
import { authorizeCall } from '../../../../services/calls/authorize'

export default defineEventHandler(async (event) => {
  const ctx = await authorizeCall(event, getRouterParam(event, 'roomId') ?? '', null)
  return { items: await listParticipants(ctx) }
})
