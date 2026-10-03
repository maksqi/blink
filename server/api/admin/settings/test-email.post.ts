// POST /api/admin/settings/test-email (admin): sends a test message (default: to the admin). 503 SERVICE_UNAVAILABLE
// without SMTP or when sending fails (`details.smtpError`).
import { adminTestEmailSchema } from '#shared/schemas/admin'
import { adminActor, sendTestEmail } from '../../../services/admin'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const body = await readValidatedBody(event, (value) => adminTestEmailSchema.parse(value ?? {}))
  return sendTestEmail(body.to ?? admin.email, adminActor(admin, event))
})
