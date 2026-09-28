// POST /api/calls/:roomId/participants/:identity/name (rooms-backend): participant.rename. 204.
import { renameSchema } from '#shared/schemas/calls'
import { renameParticipant } from '../../../../../services/calls/actions'
import { authorizeCall } from '../../../../../services/calls/authorize'

export default defineEventHandler(async (event) => {
  const ctx = await authorizeCall(event, getRouterParam(event, 'roomId') ?? '', 'participant.rename', {
    targetIdentity: getRouterParam(event, 'identity'),
  })
  const body = await readValidatedBody(event, renameSchema.parse)
  await renameParticipant(event, ctx, body.displayName)
  return sendNoContent(event)
})
