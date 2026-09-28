/**
 * Server-internal interfaces shared by parallel workstreams (orchestrator-owned).
 * Implementations: server-core (Clock, EventBus), rooms-backend (RoomServiceAdapter, publishRoomState).
 * Tests inject fakes through these interfaces.
 */
import type { RoomMetadata } from '#shared/schemas/livekit'

export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }

// ---- Event bus (in-process today; Postgres LISTEN/NOTIFY or Redis for multi-node later) ------------------------

export type BusEvent =
  | { type: 'lobby.changed'; roomId: string }
  | { type: 'lobby.decided'; requestId: string; decision: 'admitted' | 'denied' | 'removed' | 'ended' }
  | { type: 'room.state'; roomId: string }
  | { type: 'recording.changed'; roomId: string; recordingId: string }
  /** A user was disabled, deleted or had all sessions revoked: remove them from live calls. */
  | {
      type: 'user.revoked'
      userId: string
      reason?: 'password_changed' | 'password_reset' | 'disabled' | 'deleted' | 'sessions_revoked' | 'role_changed'
    }

export interface EventBus {
  publish(event: BusEvent): void
  /** Returns an unsubscribe function. */
  subscribe(listener: (event: BusEvent) => void): () => void
}

// ---- LiveKit ------------------------------------------------------------------------------------------------------

export type TrackSourceName = 'camera' | 'microphone' | 'screen_share' | 'screen_share_audio'

/** Always the complete permission object: LiveKit replaces permissions as a whole. */
export interface ParticipantPermissionSpec {
  canSubscribe: true
  canPublish: boolean
  canPublishData: boolean
  canPublishSources: TrackSourceName[]
  /** Always false: names, metadata and attributes are written only by the server. */
  canUpdateMetadata: false
  hidden: false
}

export interface LiveRoomInfo {
  name: string
  sid: string
  numParticipants: number
  createdAt: Date
  metadata: string
}

export interface LiveParticipantInfo {
  identity: string
  name: string
  attributes: Record<string, string>
  joinedAt: Date
  tracks: Array<{ sid: string; source: TrackSourceName | 'unknown'; muted: boolean }>
}

/** Thin, fakeable wrapper around livekit-server-sdk's RoomServiceClient (rooms-backend implements it). */
export interface RoomServiceAdapter {
  createRoom(input: {
    name: string
    maxParticipants: number
    emptyTimeoutSec: number
    departureTimeoutSec: number
    metadata: string
  }): Promise<{ sid: string }>
  deleteRoom(name: string): Promise<void>
  listRooms(names?: string[]): Promise<LiveRoomInfo[]>
  listParticipants(room: string): Promise<LiveParticipantInfo[]>
  getParticipant(room: string, identity: string): Promise<LiveParticipantInfo | null>
  updateRoomMetadata(room: string, metadata: string): Promise<void>
  updateParticipant(
    room: string,
    identity: string,
    update: { name?: string; attributes?: Record<string, string>; permission?: ParticipantPermissionSpec },
  ): Promise<void>
  mutePublishedTrack(room: string, identity: string, trackSid: string): Promise<void>
  removeParticipant(room: string, identity: string, options?: { revokeTokensIssuedBefore?: Date }): Promise<void>
  sendData(room: string, payload: Uint8Array, options: { topic: string; destinationIdentities: string[] }): Promise<void>
}

/**
 * Single writer of LiveKit room metadata: rebuilds `RoomMetadata` from the database and pushes it.
 * Every feature that changes room-level state (lock, policies, recording) calls this instead of writing metadata.
 */
export type PublishRoomState = (roomId: string) => Promise<RoomMetadata | null>
