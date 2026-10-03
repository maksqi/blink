// PUT /api/admin/settings (admin): a strict partial update; the merged result is re-validated and applies at once.
import { adminActor, updateAdminSettings } from '../../../services/admin'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  // The settings service validates the raw body itself: parsing it here would fill in defaults for keys not sent.
  const body: unknown = await readBody(event)
  return updateAdminSettings(body ?? {}, adminActor(admin, event))
})
