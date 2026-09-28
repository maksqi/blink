// POST /api/calls/:roomId/participants/:identity/role (rooms-backend): participant.role (host only) — co-host or
// participant; users are persisted in room_members, guests only on the live row. 204.
import { roleChangeSchema } from '#shared/schemas/calls'
import { changeRole } from '../../../../../services/calls/actions'
import { authorizeCall } from '../../../../../services/calls/authorize'

export default defineEventHandler(async (event) => {
  const ctx = await authorizeCall(event, getRouterParam(event, 'roomId') ?? '', 'participant.role', {
    targetIdentity: getRouterParam(event, 'identity'),
  })
  const body = await readValidatedBody(event, roleChangeSchema.parse)
  await changeRole(event, ctx, body.role)
  return sendNoContent(event)
})
