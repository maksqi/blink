/**
 * Shared helpers of the admin services (Stage 03).
 *
 * - `AdminActor` (from the users service): `{ user: await requireAdmin(event), event }`.
 * - `assertAdminActor(actor)`: defense in depth (handlers already called `requireAdmin`); returns the actor's clock.
 * - `adminActor(user, event)`: builds the actor in handlers.
 * - `routeId(value)`: a route `:id` that must be a uuid; anything else is 404 `NOT_FOUND` (never a database error).
 * - `likePattern(q)`: `%q%` with `\`, `%` and `_` escaped for `ILIKE`.
 */
import type { H3Event } from 'h3'
import type { AuthUser } from '#shared/schemas/auth'
import { apiError } from '../../utils/api-error'
import { assertAdmin, type AdminActor } from '../users/actor'

export type { AdminActor }

export const assertAdminActor = assertAdmin

export function adminActor(user: AuthUser, event: H3Event | null): AdminActor {
  return { user, event }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function routeId(value: string | undefined): string {
  if (!value || !UUID.test(value)) throw apiError('NOT_FOUND', 404)
  return value.toLowerCase()
}

export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}
