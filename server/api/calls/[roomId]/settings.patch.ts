// PATCH /api/calls/:roomId/settings (rooms-backend): `locked` needs call.lock (host or co-host), every other field
// call.settings (host); a request mixing both needs both. → { state: RoomMetadata } after publishRoomState.
import { liveSettingsSchema } from '#shared/schemas/calls'
import { canPerform } from '#shared/utils/permissions'
import { liveSettingsActions, updateLiveSettings } from '../../../services/calls/actions'
import { authorizeCall } from '../../../services/calls/authorize'

export default defineEventHandler(async (event) => {
  const ctx = await authorizeCall(event, getRouterParam(event, 'roomId') ?? '', 'call.lock')
  const patch = await readValidatedBody(event, (raw) => liveSettingsSchema.parse(raw ?? {}))
  if (liveSettingsActions(patch).some((action) => !canPerform(ctx.actor, action))) throw apiError('CALL_FORBIDDEN', 403)
  return { state: await updateLiveSettings(event, ctx, patch) }
})
