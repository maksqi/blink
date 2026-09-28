// PUT /api/rooms/:id/key (rooms-backend): owner only; new join proof for a new K, key_version + 1; 409 MEETING_LIVE
// while a meeting is live. Old links then fail with ROOM_KEY_INVALID.
import { rotateRoomKeySchema } from '#shared/schemas/rooms'
import { audit } from '../../../services/audit/audit'
import { requireRoomAccess, roomDetails, rotateRoomKey } from '../../../services/rooms/rooms'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { room } = await requireRoomAccess(user.id, getRouterParam(event, 'id') ?? '', 'owner')
  const body = await readValidatedBody(event, rotateRoomKeySchema.parse)
  const updated = await rotateRoomKey(room, body.proof)
  await audit(event, {
    action: 'room.key_rotated',
    targetType: 'room',
    targetId: room.id,
    details: { keyVersion: updated.keyVersion },
  })
  return { room: await roomDetails(updated, user.id) }
})
