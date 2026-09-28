// POST /api/rooms (rooms-backend): the browser sends slug, name, settings and the join proof; K never reaches the
// server (docs/API.md §5). 201 { room }.
import { createRoomSchema } from '#shared/schemas/rooms'
import { audit } from '../../services/audit/audit'
import { createRoom } from '../../services/rooms/rooms'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  consumeOr429(event, 'room-create', userLimiterKey(user.id))
  const body = await readValidatedBody(event, createRoomSchema.parse)
  const room = await createRoom(user, body)
  await audit(event, { action: 'room.created', targetType: 'room', targetId: room.id, details: { ephemeral: room.ephemeral } })
  setResponseStatus(event, 201)
  return { room }
})
