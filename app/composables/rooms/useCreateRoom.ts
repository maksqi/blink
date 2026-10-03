/**
 * "New room" and "Instant meeting" (rooms-ui, Stage 04): the browser makes the slug and the key, the server gets the
 * join proof only. Afterwards K is in the user's key vault and in this tab's key, and `/m/<slug>` opens by in-app
 * navigation, without a fragment (decision): the meeting page finds the key in the tab.
 */
import type { RoomDetails } from '#shared/schemas/rooms'
import { createRoomWithKey, type CreateRoomInput } from '~/lib/join/create-room'
import { ApiError } from '../useApi'
import { useKeyVault } from './useKeyVault'
import { useRoomsApi } from './useRoomsApi'

export function useCreateRoom() {
  const rooms = useRoomsApi()
  const vault = useKeyVault()

  async function create(input: CreateRoomInput): Promise<RoomDetails> {
    const { room, key } = await createRoomWithKey(input, {
      post: rooms.create,
      isSlugTaken: (error) => error instanceof ApiError && error.code === 'CONFLICT',
    })
    vault.save({ roomId: room.id, slug: room.slug, key, keyVersion: room.keyVersion })
    vault.tab.save(room.slug, { key })
    return room
  }

  /** Creates the room and opens its meeting page. */
  async function createAndOpen(input: CreateRoomInput): Promise<RoomDetails> {
    const room = await create(input)
    await navigateTo(`/m/${room.slug}`)
    return room
  }

  return { create, createAndOpen }
}
