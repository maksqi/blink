// POST /api/calls/:roomId/me/name (rooms-backend): self.rename — the caller's name in this call. 204.
import { renameSchema } from '#shared/schemas/calls'
import { renameSelf } from '../../../../services/calls/actions'
import { authorizeCall } from '../../../../services/calls/authorize'

export default defineEventHandler(async (event) => {
  const ctx = await authorizeCall(event, getRouterParam(event, 'roomId') ?? '', 'self.rename')
  const body = await readValidatedBody(event, renameSchema.parse)
  await renameSelf(event, ctx, body.displayName)
  return sendNoContent(event)
})
