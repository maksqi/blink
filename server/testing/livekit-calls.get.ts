// Test/dev builds only (registered in nuxt.config.ts). Owner: rooms-backend (Stage 04).
// Returns the calls recorded by the in-memory fake RoomServiceAdapter selected with LIVEKIT_URL=fake://local, as
// `[{ method, args, at }]` (args as passed to the adapter), optionally only the calls about one room (`?room=<roomId>`).
// 404 NOT_FOUND when the fake is not in use.
import type { FakeCall } from '../services/livekit/fake-room-service'
import { activeFakeRoomService } from '../services/livekit/room-service'

function concernsRoom(call: FakeCall, room: string): boolean {
  const [first] = call.args
  if (first === room) return true
  if (Array.isArray(first)) return first.includes(room)
  return typeof first === 'object' && first !== null && (first as { name?: unknown }).name === room
}

export default defineEventHandler((event) => {
  const fake = activeFakeRoomService()
  if (!fake) throw apiError('NOT_FOUND', 404)
  const room = getQuery(event).room
  return typeof room === 'string' ? fake.calls.filter((call) => concernsRoom(call, room)) : [...fake.calls]
})
