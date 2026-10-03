// GET /api/admin/users/:id (admin): one account. 404 NOT_FOUND.
import { routeId } from '../../../../services/admin'
import { getAdminUser } from '../../../../services/users'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = routeId(getRouterParam(event, 'id'))
  return { user: await getAdminUser(id) }
})
