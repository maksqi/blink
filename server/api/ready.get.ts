// GET /api/ready (server-core): 200 when the database answers and migrations are applied, else 503
// SERVICE_UNAVAILABLE with details.checks. LiveKit reachability is informational (docs/API.md §2).
import { checkReadiness } from '../utils/readiness'

export default defineEventHandler(async () => {
  const { ready, checks } = await checkReadiness()
  if (!ready) throw apiError('SERVICE_UNAVAILABLE', 503, { checks })
  return { status: 'ready' as const, checks }
})
