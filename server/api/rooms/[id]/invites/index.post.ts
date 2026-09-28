// POST /api/rooms/:id/invites (rooms-backend): owner or co-host; expiry 1h|24h|7d|never, optional max uses.
// 201 { invite } (the client builds the link with the K it holds).
import { createRoomInviteSchema } from '#shared/schemas/rooms'
import { audit } from '../../../../services/audit/audit'
import { createInvite } from '../../../../services/invites/invites'
import { requireRoomAccess } from '../../../../services/rooms/rooms'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { room } = await requireRoomAccess(user.id, getRouterParam(event, 'id') ?? '', 'member')
  consumeOr429(event, 'room-create', userLimiterKey(user.id))
  const body = await readValidatedBody(event, createRoomInviteSchema.parse)
  const invite = await createInvite(room.id, user.id, body)
  await audit(event, {
    action: 'room.invite_created',
    targetType: 'room_invite',
    targetId: invite.id,
    details: { roomId: room.id, expiresIn: body.expiresIn, maxUses: body.maxUses },
  })
  setResponseStatus(event, 201)
  return { invite }
})
