import { z } from 'zod'
import { displayNameSchema } from './common'
import type { ParticipantKind, ParticipantRole } from './livekit'
import { screenSharePolicySchema } from './rooms'

/** In-call endpoints: /api/calls/:roomId/... The caller is resolved to their own call_participants row. */

export const renameSchema = z.object({ displayName: displayNameSchema })
export const handSchema = z.object({ raised: z.boolean() })

export const muteSchema = z.object({ source: z.enum(['microphone', 'camera', 'screen_share']) })

/** Grant/revoke publishing ("give voice"). Omitted fields stay unchanged. */
export const permissionsSchema = z.object({
  microphone: z.boolean().optional(),
  camera: z.boolean().optional(),
})

export const volumeSchema = z.object({ level: z.number().int().min(0).max(100) })
export const roleChangeSchema = z.object({ role: z.enum(['cohost', 'participant']) })
export const muteAllSchema = z.object({ preventSelfUnmute: z.boolean().default(false) })

/** PATCH /api/calls/:roomId/settings — live settings (lock is allowed for co-hosts, the rest host-only). */
export const liveSettingsSchema = z
  .object({
    locked: z.boolean(),
    waitingRoom: z.boolean(),
    screenSharePolicy: screenSharePolicySchema,
    allowSelfUnmute: z.boolean(),
    chatEnabled: z.boolean(),
  })
  .partial()

export interface LobbyEntry {
  requestId: string
  displayName: string
  kind: ParticipantKind
  requestedAt: string
}

export interface CallParticipantInfo {
  identity: string
  displayName: string
  role: ParticipantRole
  kind: ParticipantKind
  micAllowed: boolean
  cameraAllowed: boolean
  volumeLevel: number
  handRaisedAt: string | null
  joinedAt: string | null
}
