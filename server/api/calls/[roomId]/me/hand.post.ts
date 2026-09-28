// POST /api/calls/:roomId/me/hand (rooms-backend): self.hand — raise or lower the caller's hand. 204.
import { handSchema } from '#shared/schemas/calls'
import { setOwnHand } from '../../../../services/calls/actions'
import { authorizeCall } from '../../../../services/calls/authorize'

export default defineEventHandler(async (event) => {
  const ctx = await authorizeCall(event, getRouterParam(event, 'roomId') ?? '', 'self.hand')
  const body = await readValidatedBody(event, handSchema.parse)
  await setOwnHand(ctx, body.raised)
  return sendNoContent(event)
})
