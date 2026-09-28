// POST /api/calls/:roomId/participants/:identity/remove (rooms-backend): participant.remove — final for the meeting;
// LiveKit removes the identity and revokes its tokens. 204.
import { removeParticipant } from '../../../../../services/calls/actions'
import { authorizeCall } from '../../../../../services/calls/authorize'

export default defineEventHandler(async (event) => {
  const ctx = await authorizeCall(event, getRouterParam(event, 'roomId') ?? '', 'participant.remove', {
    targetIdentity: getRouterParam(event, 'identity'),
  })
  await removeParticipant(event, ctx)
  return sendNoContent(event)
})
