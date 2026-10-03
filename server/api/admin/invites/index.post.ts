// POST /api/admin/invites (admin): an account invite; the token is returned once (link `${publicUrl}/invite#<token>`)
// and stored as sha256 only. Admin-role invites need an email and expire within 24 h. 201.
import { adminCreateInviteSchema } from '#shared/schemas/admin'
import { adminActor } from '../../../services/admin'
import { createAccountInvite } from '../../../services/users'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const body = await readValidatedBody(event, adminCreateInviteSchema.parse)
  const invite = await createAccountInvite(body, adminActor(admin, event))
  setResponseStatus(event, 201)
  return invite
})
