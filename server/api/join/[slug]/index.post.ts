// POST /api/join/:slug (rooms-backend): 200 JoinGrant or 202 JoinWaiting; guests get the per-room guest cookie
// (docs/API.md §6). Check order: server/services/join/checks.ts.
import { joinRequestSchema } from '#shared/schemas/join'
import { joinRoom } from '../../../services/join/join'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, joinRequestSchema.parse)
  const outcome = await joinRoom(event, getRouterParam(event, 'slug') ?? '', body)
  setResponseStatus(event, outcome.status)
  return outcome.body
})
