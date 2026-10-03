// GET /api/admin/settings (admin): every setting plus the SMTP status (host and sender only).
import { getAdminSettings } from '../../../services/admin'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return getAdminSettings()
})
