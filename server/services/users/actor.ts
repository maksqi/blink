/**
 * Who performs an admin action (auth, for the Stage 03 admin handlers):
 *
 *   const admin = await requireAdmin(event)
 *   return updateUserByAdmin(id, patch, { user: admin, event })
 *
 * The event gives the audit entry its IP and lets services rotate the caller's own session (self-demotion). Services
 * write the audit entry themselves (inside their transaction); handlers must not write a second one.
 */
import type { H3Event } from 'h3'
import type { AuthUser } from '#shared/schemas/auth'
import { apiError } from '../../utils/api-error'

export interface AdminActor {
  user: Pick<AuthUser, 'id' | 'role'> & Partial<Pick<AuthUser, 'displayName'>>
  /** The admin's request; null outside requests (tests, CLI). */
  event: H3Event | null
  /** Injectable clock. */
  now?: Date
}

/** Defense in depth: handlers already called `requireAdmin`. */
export function assertAdmin(actor: AdminActor): Date {
  if (actor.user.role !== 'admin') throw apiError('FORBIDDEN', 403)
  return actor.now ?? new Date()
}
