/**
 * In-memory `RoomServiceAdapter` for API tests (rooms-backend, docs/API.md §11, docs/TESTING.md §5.4). Selected only in
 * test and dev builds when `LIVEKIT_URL` starts with `fake://` (see room-service.ts). It records every call as
 * `{ method, args, at }` for `GET /api/__test/livekit-calls` and behaves like LiveKit where the app depends on it:
 * - rooms exist between `createRoom` and `deleteRoom`; like the real adapter, deleting a missing room or removing a
 *   missing participant is a no-op, lookups answer null or [], and other calls on a missing room or participant fail
 *   with a `not_found` ServerError;
 * - any identity in an existing room is "connected" with an unmuted microphone and camera track
 *   (`TR_<source>_<identity>`) until it is removed; screen-share tracks appear only through `simulateTracks()`;
 * - `sendData` with no destination identities is refused (it would broadcast).
 * Arguments are recorded JSON-friendly: payload bytes as UTF-8 text, dates as ISO strings.
 */
import { randomBytes } from 'node:crypto'
import { ServerError } from 'livekit-server-sdk'
import type {
  LiveParticipantInfo,
  LiveRoomInfo,
  ParticipantPermissionSpec,
  RoomServiceAdapter,
  TrackSourceName,
} from '../../contracts'

export interface FakeCall {
  method: string
  args: unknown[]
  at: string
}

interface FakeTrack {
  sid: string
  source: TrackSourceName
  muted: boolean
}

interface FakeParticipant {
  identity: string
  name: string
  attributes: Record<string, string>
  permission?: ParticipantPermissionSpec
  joinedAt: Date
  tracks: FakeTrack[]
}

interface FakeRoom {
  name: string
  sid: string
  createdAt: Date
  metadata: string
  maxParticipants: number
  participants: Map<string, FakeParticipant>
  removed: Set<string>
}

export interface FakeRoomService extends RoomServiceAdapter {
  readonly calls: readonly FakeCall[]
  /** Replaces the tracks of a (synthesized) participant, e.g. to add a screen share. */
  simulateTracks(room: string, identity: string, tracks: Array<{ source: TrackSourceName; muted?: boolean }>): void
  hasRoom(name: string): boolean
  reset(): void
}

export const FAKE_MAX_CALLS = 5_000

function notFound(what: string): ServerError {
  return new ServerError('not_found', `${what} not found`, 404, 'not_found')
}

function jsonArg(value: unknown): unknown {
  if (value instanceof Uint8Array) return new TextDecoder().decode(value)
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(jsonArg)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonArg(item)]))
  }
  return value
}

export function createFakeRoomService(options: { now?: () => Date; maxCalls?: number } = {}): FakeRoomService {
  const now = options.now ?? (() => new Date())
  const maxCalls = options.maxCalls ?? FAKE_MAX_CALLS
  const calls: FakeCall[] = []
  const rooms = new Map<string, FakeRoom>()

  const record = (method: string, args: unknown[]) => {
    calls.push({ method, args: args.map(jsonArg), at: now().toISOString() })
    if (calls.length > maxCalls) calls.splice(0, calls.length - maxCalls)
  }

  const room = (name: string): FakeRoom => {
    const found = rooms.get(name)
    if (!found) throw notFound('room')
    return found
  }

  const participant = (target: FakeRoom, identity: string): FakeParticipant | null => {
    if (target.removed.has(identity)) return null
    let found = target.participants.get(identity)
    if (!found) {
      found = {
        identity,
        name: '',
        attributes: {},
        joinedAt: now(),
        tracks: (['microphone', 'camera'] as const).map((source) => ({ sid: `TR_${source}_${identity}`, source, muted: false })),
      }
      target.participants.set(identity, found)
    }
    return found
  }

  const info = (p: FakeParticipant): LiveParticipantInfo => ({
    identity: p.identity,
    name: p.name,
    attributes: { ...p.attributes },
    joinedAt: p.joinedAt,
    tracks: p.tracks.map((t) => ({ ...t })),
  })

  return {
    get calls() {
      return calls
    },

    async createRoom(input) {
      record('createRoom', [input])
      const existing = rooms.get(input.name)
      if (existing) return { sid: existing.sid }
      const sid = `RM_${randomBytes(6).toString('hex')}`
      rooms.set(input.name, {
        name: input.name,
        sid,
        createdAt: now(),
        metadata: input.metadata,
        maxParticipants: input.maxParticipants,
        participants: new Map(),
        removed: new Set(),
      })
      return { sid }
    },

    async deleteRoom(name) {
      record('deleteRoom', [name])
      rooms.delete(name)
    },

    async listRooms(names) {
      record('listRooms', [names ?? null])
      const all = [...rooms.values()].filter((r) => !names?.length || names.includes(r.name))
      return all.map(
        (r): LiveRoomInfo => ({
          name: r.name,
          sid: r.sid,
          numParticipants: r.participants.size,
          createdAt: r.createdAt,
          metadata: r.metadata,
        }),
      )
    },

    async listParticipants(name) {
      record('listParticipants', [name])
      const target = rooms.get(name)
      return target ? [...target.participants.values()].map(info) : []
    },

    async getParticipant(name, identity) {
      record('getParticipant', [name, identity])
      const target = rooms.get(name)
      if (!target) return null
      const found = participant(target, identity)
      return found ? info(found) : null
    },

    async updateRoomMetadata(name, metadata) {
      record('updateRoomMetadata', [name, metadata])
      room(name).metadata = metadata
    },

    async updateParticipant(name, identity, update) {
      record('updateParticipant', [name, identity, update])
      const found = participant(room(name), identity)
      if (!found) throw notFound('participant')
      if (update.name) found.name = update.name
      if (update.permission) found.permission = update.permission
      // Like LiveKit: attributes merge, and an empty value removes the key.
      const merged = { ...found.attributes, ...update.attributes }
      found.attributes = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== ''))
    },

    async mutePublishedTrack(name, identity, trackSid) {
      record('mutePublishedTrack', [name, identity, trackSid])
      const found = participant(room(name), identity)
      const track = found?.tracks.find((t) => t.sid === trackSid)
      if (!track) throw notFound('track')
      track.muted = true
    },

    async removeParticipant(name, identity, removeOptions) {
      record('removeParticipant', [name, identity, removeOptions ?? {}])
      const target = rooms.get(name)
      if (!target) return
      target.participants.delete(identity)
      target.removed.add(identity)
    },

    async sendData(name, payload, sendOptions) {
      record('sendData', [name, payload, sendOptions])
      if (sendOptions.destinationIdentities.length === 0) throw new Error('fake LiveKit: refusing a broadcast')
      room(name)
    },

    simulateTracks(name, identity, tracks) {
      const found = participant(room(name), identity)
      if (!found) throw notFound('participant')
      found.tracks = tracks.map((t) => ({ sid: `TR_${t.source}_${identity}`, source: t.source, muted: t.muted ?? false }))
    },

    hasRoom(name) {
      return rooms.has(name)
    },

    reset() {
      calls.length = 0
      rooms.clear()
    },
  }
}
