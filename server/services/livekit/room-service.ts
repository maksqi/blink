/**
 * The `RoomServiceAdapter` (server/contracts) over livekit-server-sdk's `RoomServiceClient` (rooms-backend). Every
 * LiveKit call of the app goes through `roomService()`.
 *
 * - `createLivekitRoomService({ url, apiKey, apiSecret })`: the real adapter. Deleting a missing room or removing a
 *   missing participant is a no-op; `getParticipant` answers null for a missing room or participant;
 *   `listParticipants` answers [] for a missing room. `sendData` never broadcasts: an empty destination list sends
 *   nothing (LiveKit would deliver it to everyone).
 * - `roomService()`: the process-wide adapter for `LIVEKIT_URL`. `fake://…` selects the in-memory fake
 *   (fake-room-service.ts), but only in test and dev builds (`__BLINQ_TEST_HOOKS__` or `import.meta.dev`); a
 *   production build refuses it.
 * - `activeFakeRoomService()`: the fake in use, or null (`GET /api/__test/livekit-calls`).
 * - `setRoomServiceForTesting(adapter?)`: in-process tests inject an adapter; call without an argument to reset.
 * - `isLivekitNotFound(error)`.
 */
import {
  DataPacket_Kind,
  type ParticipantInfo,
  ParticipantPermission,
  type Room,
  RoomServiceClient,
  ServerError,
} from 'livekit-server-sdk'
import type { LiveParticipantInfo, LiveRoomInfo, ParticipantPermissionSpec, RoomServiceAdapter } from '../../contracts'
import { env } from '../../utils/env'
import { createFakeRoomService, type FakeRoomService } from './fake-room-service'
import { fromTrackSource, toTrackSource } from './token'

const REQUEST_TIMEOUT_SEC = 5

export function isLivekitNotFound(error: unknown): boolean {
  if (!(error instanceof ServerError)) return false
  return error.code === 'not_found' || error.status === 404
}

function toDate(ms: bigint, seconds: bigint): Date {
  const value = Number(ms) || Number(seconds) * 1000
  return new Date(value || Date.now())
}

function toRoomInfo(room: Room): LiveRoomInfo {
  return {
    name: room.name,
    sid: room.sid,
    numParticipants: room.numParticipants,
    createdAt: toDate(room.creationTimeMs, room.creationTime),
    metadata: room.metadata,
  }
}

function toParticipantInfo(p: ParticipantInfo): LiveParticipantInfo {
  return {
    identity: p.identity,
    name: p.name,
    attributes: { ...p.attributes },
    joinedAt: toDate(p.joinedAtMs, p.joinedAt),
    tracks: p.tracks.map((t) => ({ sid: t.sid, source: fromTrackSource(t.source), muted: t.muted })),
  }
}

function toPermission(spec: ParticipantPermissionSpec): ParticipantPermission {
  // Every field is set explicitly: LiveKit replaces the permission object as a whole.
  return new ParticipantPermission({
    canSubscribe: spec.canSubscribe,
    canPublish: spec.canPublish,
    canPublishData: spec.canPublishData,
    canPublishSources: spec.canPublishSources.map(toTrackSource),
    canUpdateMetadata: false,
    hidden: false,
    recorder: false,
    agent: false,
    canSubscribeMetrics: false,
    canManageAgentSession: false,
  })
}

export function createLivekitRoomService(options: { url: string; apiKey: string; apiSecret: string }): RoomServiceAdapter {
  const client = new RoomServiceClient(options.url, options.apiKey, options.apiSecret, {
    requestTimeout: REQUEST_TIMEOUT_SEC,
    failover: false,
  })

  const ignoreNotFound = async (call: () => Promise<unknown>) => {
    try {
      await call()
    } catch (error) {
      if (!isLivekitNotFound(error)) throw error
    }
  }

  return {
    async createRoom(input) {
      const room = await client.createRoom({
        name: input.name,
        maxParticipants: input.maxParticipants,
        emptyTimeout: input.emptyTimeoutSec,
        departureTimeout: input.departureTimeoutSec,
        metadata: input.metadata,
      })
      return { sid: room.sid }
    },
    async deleteRoom(name) {
      await ignoreNotFound(() => client.deleteRoom(name))
    },
    async listRooms(names) {
      return (await client.listRooms(names)).map(toRoomInfo)
    },
    async listParticipants(room) {
      try {
        return (await client.listParticipants(room)).map(toParticipantInfo)
      } catch (error) {
        if (isLivekitNotFound(error)) return []
        throw error
      }
    },
    async getParticipant(room, identity) {
      try {
        return toParticipantInfo(await client.getParticipant(room, identity))
      } catch (error) {
        if (isLivekitNotFound(error)) return null
        throw error
      }
    },
    async updateRoomMetadata(room, metadata) {
      await client.updateRoomMetadata(room, metadata)
    },
    async updateParticipant(room, identity, update) {
      await client.updateParticipant(room, identity, {
        name: update.name,
        attributes: update.attributes,
        permission: update.permission ? toPermission(update.permission) : undefined,
      })
    },
    async mutePublishedTrack(room, identity, trackSid) {
      await client.mutePublishedTrack(room, identity, trackSid, true)
    },
    async removeParticipant(room, identity, removeOptions) {
      const revokeAt = removeOptions?.revokeTokensIssuedBefore
      await ignoreNotFound(() =>
        client.removeParticipant(room, identity, {
          revokeTokenTs: revokeAt ? BigInt(Math.ceil(revokeAt.getTime() / 1000)) : undefined,
        }),
      )
    },
    async sendData(room, payload, sendOptions) {
      if (sendOptions.destinationIdentities.length === 0) return
      await client.sendData(room, payload, DataPacket_Kind.RELIABLE, {
        topic: sendOptions.topic,
        destinationIdentities: sendOptions.destinationIdentities,
      })
    },
  }
}

// ---- Process-wide selection ------------------------------------------------------------------------------------------

/** True in `pnpm build:test` output and `nuxt dev`; false in production builds and plain Vitest. */
export function testHooksEnabled(): boolean {
  const flag = typeof __BLINQ_TEST_HOOKS__ !== 'undefined' && __BLINQ_TEST_HOOKS__
  return flag || Boolean(import.meta.dev)
}

export function isFakeLivekitUrl(url: string): boolean {
  return url.startsWith('fake://')
}

let override: RoomServiceAdapter | undefined
let selected: { url: string; adapter: RoomServiceAdapter; fake: FakeRoomService | null } | undefined

export function roomService(): RoomServiceAdapter {
  if (override) return override
  const config = env()
  if (selected?.url === config.LIVEKIT_URL) return selected.adapter
  if (isFakeLivekitUrl(config.LIVEKIT_URL)) {
    if (!testHooksEnabled()) throw new Error('LIVEKIT_URL=fake:// is only available in test builds')
    const fake = createFakeRoomService()
    selected = { url: config.LIVEKIT_URL, adapter: fake, fake }
  } else {
    const adapter = createLivekitRoomService({
      url: config.LIVEKIT_URL,
      apiKey: config.LIVEKIT_API_KEY,
      apiSecret: config.LIVEKIT_API_SECRET,
    })
    selected = { url: config.LIVEKIT_URL, adapter, fake: null }
  }
  return selected.adapter
}

export function activeFakeRoomService(): FakeRoomService | null {
  if (override) return null
  if (!isFakeLivekitUrl(env().LIVEKIT_URL) || !testHooksEnabled()) return null
  roomService()
  return selected?.fake ?? null
}

export function setRoomServiceForTesting(adapter?: RoomServiceAdapter): void {
  override = adapter
  selected = undefined
}
