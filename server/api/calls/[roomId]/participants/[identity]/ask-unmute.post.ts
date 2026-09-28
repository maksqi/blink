// POST /api/calls/:roomId/participants/:identity/ask-unmute (rooms-backend): participant.askUnmute — an `ask-unmute`
// hint to the target only; nothing is unmuted by the server. 204.
import { askToUnmute } from '../../../../../services/calls/actions'
import { authorizeCall } from '../../../../../services/calls/authorize'

export default defineEventHandler(async (event) => {
  const ctx = await authorizeCall(event, getRouterParam(event, 'roomId') ?? '', 'participant.askUnmute', {
    targetIdentity: getRouterParam(event, 'identity'),
  })
  await askToUnmute(event, ctx)
  return sendNoContent(event)
})
