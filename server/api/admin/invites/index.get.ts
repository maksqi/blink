// GET /api/admin/invites (admin): account invites, newest first; `q` matches the email.
import { paginationQuerySchema } from '#shared/schemas/common'
import { listAccountInvites } from '../../../services/users'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const query = await getValidatedQuery(event, paginationQuerySchema.parse)
  return listAccountInvites(query)
})
