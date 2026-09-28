// POST /api/rooms/:id/cohosts (rooms-backend): owner only; an existing enabled user becomes a co-host
// (404 NOT_FOUND otherwise, 409 CONFLICT `already_cohost` / `self`). { room }.
import { addCohostSchema } from '#shared/schemas/rooms'
import { audit } from '../../../../services/audit/audit'
import { addCohost, requireRoomAccess, roomDetails } from '../../../../services/rooms/rooms'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { room } = await requireRoomAccess(user.id, getRouterParam(event, 'id') ?? '', 'owner')
  const body = await readValidatedBody(event, addCohostSchema.parse)
  await addCohost(room, body.userId)
  await audit(event, { action: 'room.cohost_added', targetType: 'room', targetId: room.id, details: { userId: body.userId } })
  return { room: await roomDetails(room, user.id) }
})
