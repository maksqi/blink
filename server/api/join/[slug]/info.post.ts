// POST /api/join/:slug/info (rooms-backend): nothing about the room without a valid proof; a supplied invite must be
// genuine (never consumed). → JoinInfo (docs/API.md §6).
import { joinInfoSchema } from '#shared/schemas/join'
import { getJoinInfo } from '../../../services/join/join'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, joinInfoSchema.parse)
  return getJoinInfo(event, getRouterParam(event, 'slug') ?? '', body)
})
