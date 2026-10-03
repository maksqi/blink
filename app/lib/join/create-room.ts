/**
 * Room creation with a browser-generated slug and key (rooms-ui, docs/ARCHITECTURE.md §6.1):
 * slug = `generateSlug()`, K = `generateRoomKey()`, proof = `deriveJoinProof(K, slug)` → `POST /api/rooms`. Only the
 * proof reaches the server. A taken slug (409 `CONFLICT`) is retried once with a new slug *and* a new key (decision:
 * nothing derived from a discarded key is reused). Key rotation uses the same key generation.
 */
import type { RoomDetails } from '#shared/schemas/rooms'
import { deriveJoinProof, generateRoomKey, generateSlug, type RoomKey } from '../e2ee/keys'

export interface CreateRoomInput {
  name: string
  ephemeral: boolean
  waitingRoom?: boolean
  allowGuests?: boolean
  muteOnJoin?: boolean
  password?: string
}

export interface CreateRoomBody extends CreateRoomInput {
  slug: string
  proof: string
}

export interface CreateRoomDeps {
  /** `POST /api/rooms`. */
  post: (body: CreateRoomBody) => Promise<{ room: RoomDetails }>
  /** True for the answer to a taken slug (409 `CONFLICT`). */
  isSlugTaken: (error: unknown) => boolean
  generateSlug?: () => string
  generateRoomKey?: () => RoomKey
  deriveJoinProof?: (key: RoomKey, slug: string) => Promise<string>
}

export interface CreatedRoom {
  room: RoomDetails
  key: RoomKey
}

const ATTEMPTS = 2

export async function createRoomWithKey(input: CreateRoomInput, deps: CreateRoomDeps): Promise<CreatedRoom> {
  const slugOf = deps.generateSlug ?? generateSlug
  const keyOf = deps.generateRoomKey ?? generateRoomKey
  const proofOf = deps.deriveJoinProof ?? deriveJoinProof
  for (let attempt = 1; ; attempt++) {
    const slug = slugOf()
    const key = keyOf()
    const proof = await proofOf(key, slug)
    try {
      const { room } = await deps.post({ ...input, slug, proof })
      return { room, key }
    } catch (error) {
      if (attempt >= ATTEMPTS || !deps.isSlugTaken(error)) throw error
    }
  }
}

/** A new key and its proof for `PUT /api/rooms/:id/key`. */
export async function newRoomKey(
  slug: string,
  deps: Pick<CreateRoomDeps, 'generateRoomKey' | 'deriveJoinProof'> = {},
): Promise<{ key: RoomKey; proof: string }> {
  const key = (deps.generateRoomKey ?? generateRoomKey)()
  const proof = await (deps.deriveJoinProof ?? deriveJoinProof)(key, slug)
  return { key, proof }
}
