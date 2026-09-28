// GET /api/health (server-core): liveness only, never touches the database (docs/API.md §2).
export default defineEventHandler(() => ({ status: 'ok' as const }))
