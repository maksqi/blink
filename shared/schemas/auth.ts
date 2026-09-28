import { z } from 'zod'
import { displayNameSchema, emailSchema, opaqueTokenSchema, passwordSchema } from './common'

export const userRoleSchema = z.enum(['admin', 'user'])
export type UserRole = z.infer<typeof userRoleSchema>

// ---- Requests ------------------------------------------------------------------------------------------------

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
})

export const registerSchema = z.object({
  email: emailSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
})

export const tokenBodySchema = z.object({ token: opaqueTokenSchema })

export const acceptInviteSchema = z.object({
  token: opaqueTokenSchema,
  /** Required unless the invite is bound to an email. */
  email: emailSchema.optional(),
  displayName: displayNameSchema,
  password: passwordSchema,
})

export const passwordResetRequestSchema = z.object({ email: emailSchema })

export const passwordResetConfirmSchema = z.object({
  token: opaqueTokenSchema,
  newPassword: passwordSchema,
})

export const updateMeSchema = z.object({ displayName: displayNameSchema })

// ---- Responses -----------------------------------------------------------------------------------------------

export interface AuthUser {
  id: string
  email: string
  displayName: string
  role: UserRole
  mustChangePassword: boolean
  emailVerified: boolean
}

export interface MeResponse {
  user: AuthUser | null
}

export interface InvitePreview {
  /** Set when the invite is bound to an email address. */
  email: string | null
  role: UserRole
  expiresAt: string
}

export interface SessionInfo {
  id: string
  current: boolean
  createdAt: string
  lastSeenAt: string
  ip: string | null
  userAgent: string | null
}
