// POST /api/calls/:roomId/participants/:identity/lower-hand (rooms-backend): participant.lowerHand. 204.
import { lowerHand } from '../../../../../services/calls/actions'
import { authorizeCall } from '../../../../../services/calls/authorize'

export default defineEventHandler(async (event) => {
  const ctx = await authorizeCall(event, getRouterParam(event, 'roomId') ?? '', 'participant.lowerHand', {
    targetIdentity: getRouterParam(event, 'identity'),
  })
  await lowerHand(event, ctx)
  return sendNoContent(event)
})
