/**
 * LiveKit identities, grants, attributes and join tokens (rooms-backend, docs/API.md §12, docs/SECURITY.md §4).
 *
 * - `newIdentity()`: `p_` + 16 random base62 characters, unrelated to user ids or emails.
 * - `publishSources(allowance, policy)`: `canPublishSources` for a role, the room's screen-share policy and the
 *   per-person microphone/camera allowances. Hosts and co-hosts get every source; participants get the microphone
 *   only when `micAllowed`, the camera only when `cameraAllowed`, and screen share (with its audio) only when the
 *   policy is `everyone`. The room's self-unmute policy is materialized into `micAllowed` (server/services/calls/
 *   policy.ts), so a per-person grant ("give voice") overrides it.
 * - `permissionSpec(...)`: the complete `ParticipantPermissionSpec` for `updateParticipant` (LiveKit replaces
 *   permissions as a whole).
 * - `participantAttributes(...)`: `role`, `kind`, `hand` ("" or 13-digit epoch ms) and `vol` ("0".."100").
 * - `buildParticipantToken(input)`: a 5-minute join token. Grants are exactly `roomJoin`, `room`, `canSubscribe`,
 *   `canPublish`, `canPublishSources`, `canPublishData` and `canUpdateOwnMetadata: false`; never `hidden`,
 *   `roomAdmin`, `roomCreate`, `roomList`, `roomRecord`, `recorder`, `agent` or a token kind.
 */
import { randomInt } from 'node:crypto'
import { AccessToken, TrackSource, type VideoGrant } from 'livekit-server-sdk'
import type { ParticipantKind, ParticipantRole } from '#shared/schemas/livekit'
import type { ParticipantPermissionSpec, TrackSourceName } from '../../contracts'

export const TOKEN_TTL_SEC = 300

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const IDENTITY = /^p_[A-Za-z0-9]{16}$/

export function newIdentity(): string {
  let out = 'p_'
  for (let i = 0; i < 16; i++) out += BASE62[randomInt(BASE62.length)]
  return out
}

export function isIdentity(value: unknown): value is string {
  return typeof value === 'string' && IDENTITY.test(value)
}

export interface PublishAllowance {
  role: ParticipantRole
  micAllowed: boolean
  cameraAllowed: boolean
}

export interface PublishPolicy {
  screenSharePolicy: 'everyone' | 'hosts'
}

const ALL_SOURCES: readonly TrackSourceName[] = ['camera', 'microphone', 'screen_share', 'screen_share_audio']

export function publishSources(allowance: PublishAllowance, policy: PublishPolicy): TrackSourceName[] {
  if (allowance.role !== 'participant') return [...ALL_SOURCES]
  const sources: TrackSourceName[] = []
  if (allowance.cameraAllowed) sources.push('camera')
  if (allowance.micAllowed) sources.push('microphone')
  // Screen-share audio is only ever granted together with screen share.
  if (policy.screenSharePolicy === 'everyone') sources.push('screen_share', 'screen_share_audio')
  return sources
}

export function permissionSpec(allowance: PublishAllowance, policy: PublishPolicy): ParticipantPermissionSpec {
  const sources = publishSources(allowance, policy)
  return {
    canSubscribe: true,
    canPublish: sources.length > 0,
    canPublishData: true,
    canPublishSources: sources,
    canUpdateMetadata: false,
    hidden: false,
  }
}

const TRACK_SOURCES: Record<TrackSourceName, TrackSource> = {
  camera: TrackSource.CAMERA,
  microphone: TrackSource.MICROPHONE,
  screen_share: TrackSource.SCREEN_SHARE,
  screen_share_audio: TrackSource.SCREEN_SHARE_AUDIO,
}

export function toTrackSource(source: TrackSourceName): TrackSource {
  return TRACK_SOURCES[source]
}

export function fromTrackSource(source: TrackSource): TrackSourceName | 'unknown' {
  const entry = Object.entries(TRACK_SOURCES).find(([, value]) => value === source)
  return entry ? (entry[0] as TrackSourceName) : 'unknown'
}

export interface AttributeInput {
  role: ParticipantRole
  kind: ParticipantKind
  handRaisedAt: Date | null
  volumeLevel: number
}

/** "" when the hand is down, else epoch milliseconds as a 13-digit string. */
export function handAttribute(raisedAt: Date | null): string {
  return raisedAt ? String(raisedAt.getTime()).padStart(13, '0') : ''
}

export function volumeAttribute(level: number): string {
  return String(Math.min(100, Math.max(0, Math.round(level))))
}

export function participantAttributes(input: AttributeInput): Record<string, string> {
  return {
    role: input.role,
    kind: input.kind,
    hand: handAttribute(input.handRaisedAt),
    vol: volumeAttribute(input.volumeLevel),
  }
}

export interface ParticipantTokenInput extends PublishAllowance, AttributeInput {
  apiKey: string
  apiSecret: string
  /** LiveKit room name = `rooms.id`. */
  roomName: string
  identity: string
  name: string
  policy: PublishPolicy
  ttlSec?: number
}

/** The video grant of a join token (exported for the grant-matrix tests). */
export function videoGrant(input: Pick<ParticipantTokenInput, 'roomName' | 'role' | 'micAllowed' | 'cameraAllowed' | 'policy'>): VideoGrant {
  const sources = publishSources(input, input.policy)
  return {
    roomJoin: true,
    room: input.roomName,
    canSubscribe: true,
    canPublish: sources.length > 0,
    canPublishSources: sources.map(toTrackSource),
    canPublishData: true,
    canUpdateOwnMetadata: false,
  }
}

export async function buildParticipantToken(input: ParticipantTokenInput): Promise<string> {
  if (!isIdentity(input.identity)) throw new TypeError('Invalid LiveKit identity')
  const token = new AccessToken(input.apiKey, input.apiSecret, {
    identity: input.identity,
    name: input.name,
    ttl: input.ttlSec ?? TOKEN_TTL_SEC,
    attributes: participantAttributes(input),
  })
  token.addGrant(videoGrant(input))
  return token.toJwt()
}
