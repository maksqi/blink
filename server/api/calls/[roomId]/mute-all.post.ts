// POST /api/calls/:roomId/mute-all (rooms-backend): call.muteAll — every participant's microphone; with
// `preventSelfUnmute` the room's self-unmute is turned off too. 204.
import { muteAllSchema } from '#shared/schemas/calls'
import { muteAll } from '../../../services/calls/actions'
import { authorizeCall } from '../../../services/calls/authorize'

export default defineEventHandler(async (event) => {
  const ctx = await authorizeCall(event, getRouterParam(event, 'roomId') ?? '', 'call.muteAll')
  const body = await readValidatedBody(event, (raw) => muteAllSchema.parse(raw ?? {}))
  await muteAll(event, ctx, body.preventSelfUnmute)
  return sendNoContent(event)
})
