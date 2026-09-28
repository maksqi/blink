// POST /api/calls/:roomId/participants/:identity/volume (rooms-backend): participant.volume — the `vol` attribute
// every receiver applies. 204.
import { volumeSchema } from '#shared/schemas/calls'
import { setVolume } from '../../../../../services/calls/actions'
import { authorizeCall } from '../../../../../services/calls/authorize'

export default defineEventHandler(async (event) => {
  const ctx = await authorizeCall(event, getRouterParam(event, 'roomId') ?? '', 'participant.volume', {
    targetIdentity: getRouterParam(event, 'identity'),
  })
  const body = await readValidatedBody(event, volumeSchema.parse)
  await setVolume(event, ctx, body.level)
  return sendNoContent(event)
})
