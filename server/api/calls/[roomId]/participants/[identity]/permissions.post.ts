// POST /api/calls/:roomId/participants/:identity/permissions (rooms-backend): participant.permissions ("give voice") —
// microphone and camera allowances; omitted fields stay. 204.
import { permissionsSchema } from '#shared/schemas/calls'
import { setPermissions } from '../../../../../services/calls/actions'
import { authorizeCall } from '../../../../../services/calls/authorize'

export default defineEventHandler(async (event) => {
  const ctx = await authorizeCall(event, getRouterParam(event, 'roomId') ?? '', 'participant.permissions', {
    targetIdentity: getRouterParam(event, 'identity'),
  })
  const body = await readValidatedBody(event, permissionsSchema.parse)
  await setPermissions(event, ctx, body)
  return sendNoContent(event)
})
