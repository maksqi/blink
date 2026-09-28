import { z } from 'zod'
import { joinProofSchema, slugSchema } from './common'

export const screenSharePolicySchema = z.enum(['everyone', 'hosts'])

const roomNameSchema = z.string().trim().min(1, 'Enter a room name').max(80)
const roomPasswordSchema = z.string().min(4, 'Use at least 4 characters').max(128)

/** Room settings editable by the owner (PATCH /api/rooms/:id). */
export const roomSettingsSchema = z.object({
  name: roomNameSchema,
  waitingRoom: z.boolean(),
  allowGuests: z.boolean(),
  muteOnJoin: z.boolean(),
  allowSelfUnmute: z.boolean(),
  screenSharePolicy: screenSharePolicySchema,
  chatEnabled: z.boolean(),
  maxParticipants: z.number().int().min(2).max(25),
})

/** POST /api/rooms — the browser generates slug + room key; only the join proof reaches the server. */
export const createRoomSchema = roomSettingsSchema.partial().extend({
  slug: slugSchema,
  name: roomNameSchema,
  proof: joinProofSchema,
  ephemeral: z.boolean().default(false),
  password: roomPasswordSchema.optional(),
})

export const updateRoomSchema = roomSettingsSchema.partial().extend({
  /** null removes the password. */
  password: roomPasswordSchema.nullable().optional(),
})

/** PUT /api/rooms/:id/key — rotate the room key (only when no meeting is live). */
export const rotateRoomKeySchema = z.object({ proof: joinProofSchema })

export const inviteExpirySchema = z.enum(['1h', '24h', '7d', 'never'])

export const createRoomInviteSchema = z.object({
  label: z.string().trim().max(80).optional(),
  expiresIn: inviteExpirySchema.default('24h'),
  maxUses: z.number().int().min(1).max(1000).nullable().default(null),
})

export const addCohostSchema = z.object({ userId: z.uuid() })

export interface RoomSummary {
  id: string
  slug: string
  name: string
  ephemeral: boolean
  isOwner: boolean
  role: 'host' | 'cohost'
  hasPassword: boolean
  waitingRoom: boolean
  live: boolean
  participantCount: number
  lastActiveAt: string | null
  createdAt: string
}

export interface RoomDetails extends RoomSummary {
  allowGuests: boolean
  muteOnJoin: boolean
  allowSelfUnmute: boolean
  screenSharePolicy: 'everyone' | 'hosts'
  chatEnabled: boolean
  maxParticipants: number
  locked: boolean
  keyVersion: number
  cohosts: Array<{ userId: string; displayName: string; email: string }>
}

export interface RoomInvite {
  id: string
  label: string | null
  /** Derived token; the client builds the full link with the room key it holds. */
  token: string
  expiresAt: string | null
  maxUses: number | null
  useCount: number
  revoked: boolean
  createdAt: string
}

export interface MeetingSummary {
  id: string
  startedAt: string
  endedAt: string | null
  peakParticipants: number
}
