// GET /api/admin/audit (admin): the audit log, newest first; `q` over the target, `action`, `actorUserId`.
import { auditQuerySchema } from '#shared/schemas/admin'
import { listAuditLog } from '../../services/admin'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const query = await getValidatedQuery(event, auditQuerySchema.parse)
  return listAuditLog(query)
})
