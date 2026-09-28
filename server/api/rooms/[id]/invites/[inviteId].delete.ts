// DELETE /api/rooms/:id/invites/:inviteId (rooms-backend): owner or co-host; sets revoked_at. 204.
import { audit } from '../../../../services/audit/audit'
import { revokeInvite } from '../../../../services/invites/invites'
import { isUuid } from '../../../../services/rooms/queries'
import { requireRoomAccess } from '../../../../services/rooms/rooms'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { room } = await requireRoomAccess(user.id, getRouterParam(event, 'id') ?? '', 'member')
  const inviteId = getRouterParam(event, 'inviteId')
  if (!isUuid(inviteId) || !(await revokeInvite(room.id, inviteId))) throw apiError('NOT_FOUND', 404)
  await audit(event, { action: 'room.invite_revoked', targetType: 'room_invite', targetId: inviteId, details: { roomId: room.id } })
  return sendNoContent(event)
})
