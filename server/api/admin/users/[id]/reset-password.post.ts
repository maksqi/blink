// POST /api/admin/users/:id/reset-password (admin): a new temporary password, shown once or emailed; the user must
// change it at the next sign-in and every session is revoked.
import { adminResetPasswordSchema } from '#shared/schemas/admin'
import { adminActor, routeId } from '../../../../services/admin'
import { resetPasswordByAdmin } from '../../../../services/users'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = routeId(getRouterParam(event, 'id'))
  // The body is optional: no body means `{ sendEmail: false }`.
  const body = await readValidatedBody(event, (value) => adminResetPasswordSchema.parse(value ?? {}))
  return resetPasswordByAdmin(id, body, adminActor(admin, event))
})
