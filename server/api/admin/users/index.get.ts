// GET /api/admin/users (admin): every account; `q` over email and name, `role`, `status`; newest first.
import { adminUsersQuerySchema } from '#shared/schemas/admin'
import { listUsers } from '../../../services/users'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const query = await getValidatedQuery(event, adminUsersQuerySchema.parse)
  return listUsers(query)
})
