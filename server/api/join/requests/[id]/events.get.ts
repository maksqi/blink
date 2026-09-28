// GET /api/join/requests/:id/events (rooms-backend): waiting-room SSE for the session or guest session that owns the
// request only (else 403 FORBIDDEN). Current state first, `: ping` every 15 s; `admitted` carries the token for this
// row only (docs/API.md §6.1). The URL carries nothing but the request id.
import { streamWaitingEvents } from '../../../../services/lobby/lobby'

export default defineEventHandler((event) => streamWaitingEvents(event, getRouterParam(event, 'id') ?? ''))
