// POST /api/calls/:roomId/recording/start (recording-server, docs/API.md §7): host or co-host with an account.
import { startRecordingSchema } from '#shared/schemas/recordings'
import { assertMayRecord, startRecording } from '../../../../services/recordings/lifecycle'

export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event, getRouterParam(event, 'roomId') ?? '')
  consumeOr429(event, 'call-actions', `participant:${caller.id}`)
  assertMayRecord(caller, 'recording.start')
  const input = await readValidatedBody(event, startRecordingSchema.parse)
  const result = await startRecording(event, caller, input)
  setResponseStatus(event, 201)
  return result
})
