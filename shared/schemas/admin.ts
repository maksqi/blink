import { z } from 'zod'
import { displayNameSchema, emailSchema, paginationQuerySchema } from './common'
import { userRoleSchema, type UserRole } from './auth'

export const adminUsersQuerySchema = paginationQuerySchema.extend({
  role: userRoleSchema.optional(),
  status: z.enum(['active', 'disabled']).optional(),
})

/** POST /api/admin/users — create an account directly; a temporary password is returned once (or emailed). */
export const adminCreateUserSchema = z.object({
  email: emailSchema,
  displayName: displayNameSchema,
  role: userRoleSchema.default('user'),
  sendEmail: z.boolean().default(false),
})

export const adminUpdateUserSchema = z
  .object({
    displayName: displayNameSchema,
    role: userRoleSchema,
    disabled: z.boolean(),
  })
  .partial()

/** POST /api/admin/invites — admin-role invites must be bound to an email and expire within 24 h. */
export const adminCreateInviteSchema = z
  .object({
    email: emailSchema.optional(),
    role: userRoleSchema.default('user'),
    expiresIn: z.enum(['24h', '7d', '30d']).default('7d'),
    sendEmail: z.boolean().default(false),
  })
  .refine((v) => v.role !== 'admin' || (v.email !== undefined && v.expiresIn === '24h'), {
    message: 'Admin invites need an email address and expire within 24 hours',
    path: ['role'],
  })

/** POST /api/admin/users/:id/reset-password — sets a temporary password (shown once or emailed). */
export const adminResetPasswordSchema = z.object({ sendEmail: z.boolean().default(false) })

/** POST /api/admin/settings/test-email — defaults to the calling admin's address. */
export const adminTestEmailSchema = z.object({ to: emailSchema.optional() })

export const auditQuerySchema = paginationQuerySchema.extend({
  action: z.string().max(80).optional(),
  actorUserId: z.uuid().optional(),
})

export interface AdminUser {
  id: string
  email: string
  displayName: string
  role: UserRole
  disabled: boolean
  mustChangePassword: boolean
  emailVerified: boolean
  lastLoginAt: string | null
  createdAt: string
  roomCount: number
}

/** Response of POST /api/admin/users and POST /api/admin/users/:id/reset-password. */
export interface CreatedUserCredentials {
  user: AdminUser
  /** Shown once; null when it was only emailed. The account must change it at first login. */
  tempPassword: string | null
  emailed: boolean
}

export interface AdminInvite {
  id: string
  email: string | null
  role: UserRole
  expiresAt: string
  usedAt: string | null
  revoked: boolean
  createdAt: string
  createdBy: string | null
}

export interface CreatedInvite extends AdminInvite {
  /** Shown once. The link is `${publicUrl}/invite#${token}`. */
  token: string
  emailed: boolean
}

export interface AdminRoom {
  id: string
  slug: string
  name: string
  owner: { id: string; displayName: string; email: string }
  live: boolean
  participantCount: number
  ephemeral: boolean
  createdAt: string
  lastActiveAt: string | null
}

export interface AuditEntry {
  id: string
  at: string
  actor: { userId: string | null; displayName: string | null; participantId: string | null }
  ip: string | null
  action: string
  targetType: string | null
  targetId: string | null
  details: Record<string, unknown> | null
}
