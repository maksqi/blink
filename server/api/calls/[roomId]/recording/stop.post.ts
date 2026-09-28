// POST /api/calls/:roomId/recording/stop (recording-server, docs/API.md §7): any moderator with an account.
import { assertMayRecord, stopRecording } from '../../../../services/recordings/lifecycle'

export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event, getRouterParam(event, 'roomId') ?? '')
  consumeOr429(event, 'call-actions', `participant:${caller.id}`)
  assertMayRecord(caller, 'recording.stop')
  await stopRecording(event, caller)
  return null
})
