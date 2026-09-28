/**
 * Builds `ParticipantView`s (the reactive projection features see) from LiveKit participants. Pure over a structural
 * participant type, so it is unit-tested without a Room.
 *
 * Attributes are server-written (`role`, `kind`, `hand`, `vol`, docs/API.md §12) and validated with
 * `participantAttributesSchema`; an invalid value falls back per field to the least-privileged default (participant,
 * guest, no hand, volume 100) instead of breaking the view.
 */
import { participantAttributesSchema, type ParticipantKind, type ParticipantRole } from '#shared/schemas/livekit'
import type { ConnectionQualityLevel, ParticipantView } from '../contracts/call'
import { parseVolumeAttribute } from '../livekit/audio-engine'

export interface ParticipantLike {
  identity: string
  name?: string
  attributes: Readonly<Record<string, string>>
  isLocal: boolean
  isSpeaking: boolean
  audioLevel: number
  connectionQuality: string
  joinedAt?: Date
  isMicrophoneEnabled: boolean
  isCameraEnabled: boolean
  isScreenShareEnabled: boolean
  trackPublications: ReadonlyMap<string, { isEncrypted: boolean }>
}

export interface ParsedAttributes {
  role: ParticipantRole
  kind: ParticipantKind
  handRaisedAt: number | null
  volumeForEveryone: number
}

const shape = participantAttributesSchema.shape

export function parseAttributes(attributes: Readonly<Record<string, string>> | undefined): ParsedAttributes {
  const attrs = attributes ?? {}
  const whole = participantAttributesSchema.safeParse(attrs)
  const role = whole.success ? whole.data.role : (shape.role.safeParse(attrs.role).data ?? 'participant')
  const kind = whole.success ? whole.data.kind : (shape.kind.safeParse(attrs.kind).data ?? 'guest')
  const hand = whole.success ? whole.data.hand : (shape.hand.safeParse(attrs.hand).data ?? '')
  const vol = whole.success ? whole.data.vol : (shape.vol.safeParse(attrs.vol).data ?? '100')
  return {
    role,
    kind,
    handRaisedAt: hand ? Number(hand) : null,
    volumeForEveryone: parseVolumeAttribute(vol),
  }
}

const QUALITIES = new Set<ConnectionQualityLevel>(['excellent', 'good', 'poor', 'lost', 'unknown'])

export function connectionQualityOf(value: string): ConnectionQualityLevel {
  return QUALITIES.has(value as ConnectionQualityLevel) ? (value as ConnectionQualityLevel) : 'unknown'
}

export interface ViewOptions {
  /** This client's own E2EE state (for the local view). */
  localEncrypted: boolean
  /** Used when LiveKit has no join time yet. */
  now: number
}

export function toParticipantView(participant: ParticipantLike, options: ViewOptions): ParticipantView {
  const attributes = parseAttributes(participant.attributes)
  let mediaEncrypted = true
  if (participant.isLocal) mediaEncrypted = options.localEncrypted
  else
    for (const publication of participant.trackPublications.values())
      if (!publication.isEncrypted) mediaEncrypted = false

  return {
    identity: participant.identity,
    name: participant.name?.trim() || 'Participant',
    role: attributes.role,
    kind: attributes.kind,
    isLocal: participant.isLocal,
    isSpeaking: participant.isSpeaking,
    audioLevel: Number.isFinite(participant.audioLevel) ? participant.audioLevel : 0,
    connectionQuality: connectionQualityOf(participant.connectionQuality),
    micEnabled: participant.isMicrophoneEnabled,
    cameraEnabled: participant.isCameraEnabled,
    screenSharing: participant.isScreenShareEnabled,
    handRaisedAt: attributes.handRaisedAt,
    volumeForEveryone: attributes.volumeForEveryone,
    mediaEncrypted,
    joinedAt: participant.joinedAt?.getTime() ?? options.now,
  }
}
