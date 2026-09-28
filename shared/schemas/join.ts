import { z } from 'zod'
import { clientIdSchema, displayNameSchema, joinProofSchema } from './common'
import type { ParticipantRole } from './livekit'

const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

/** POST /api/join/:slug/info — nothing about the room is revealed without a valid proof. */
export const joinInfoSchema = z.object({
  proof: joinProofSchema,
  inviteToken: inviteTokenSchema.optional(),
})

/** POST /api/join/:slug */
export const joinRequestSchema = z.object({
  proof: joinProofSchema,
  inviteToken: inviteTokenSchema.optional(),
  /** Ignored for signed-in users (their profile name is used). */
  displayName: displayNameSchema.optional(),
  password: z.string().max(128).optional(),
  clientId: clientIdSchema,
})

export interface JoinInfo {
  roomId: string
  name: string
  needsPassword: boolean
  waitingRoom: boolean
  recordingActive: boolean
  /** Role the caller would get; `participant` for invitees and guests. */
  yourRole: ParticipantRole
  signedIn: boolean
  guestsAllowed: boolean
  /** Room policy for pre-join defaults (filled by the join service; optional until every caller sends it). */
  muteOnJoin?: boolean
}

export interface JoinGrant {
  status: 'admitted'
  token: string
  /** LiveKit signaling URL (same origin in production). */
  url: string
  /** base64url(16 bytes) meeting epoch for per-meeting key derivation. */
  epoch: string
  identity: string
  role: ParticipantRole
  roomId: string
}

export interface JoinWaiting {
  status: 'waiting'
  requestId: string
}

export type JoinResponse = JoinGrant | JoinWaiting

/** Server-sent events on GET /api/join/requests/:id/events (only the owning session/guest cookie may subscribe). */
export type WaitingEvent =
  | { event: 'status'; data: { status: 'waiting' } }
  | { event: 'admitted'; data: Omit<JoinGrant, 'status'> }
  | { event: 'denied'; data: { reason: 'denied' | 'removed' | 'locked' } }
  | { event: 'ended'; data: Record<string, never> }
