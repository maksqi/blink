// POST /api/calls/:roomId/participants/:identity/mute (rooms-backend): participant.mute — server-mutes one source. 204.
import { muteSchema } from '#shared/schemas/calls'
import { muteParticipant } from '../../../../../services/calls/actions'
import { authorizeCall } from '../../../../../services/calls/authorize'

export default defineEventHandler(async (event) => {
  const ctx = await authorizeCall(event, getRouterParam(event, 'roomId') ?? '', 'participant.mute', {
    targetIdentity: getRouterParam(event, 'identity'),
  })
  const body = await readValidatedBody(event, muteSchema.parse)
  await muteParticipant(event, ctx, body.source)
  return sendNoContent(event)
})
