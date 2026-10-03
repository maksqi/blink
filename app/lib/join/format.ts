/**
 * Display helpers for the dashboard and the room page (pure, English, sentence case): relative times, meeting
 * durations and the state of a room invite.
 */
import type { RoomInvite } from '#shared/schemas/rooms'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'}`
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago", then the date. */
export function formatRelativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'never'
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return 'unknown'
  const diff = Math.max(0, now - time)
  if (diff < MINUTE) return 'just now'
  if (diff < HOUR) return `${plural(Math.floor(diff / MINUTE), 'minute')} ago`
  if (diff < DAY) return `${plural(Math.floor(diff / HOUR), 'hour')} ago`
  if (diff < 7 * DAY) return `${plural(Math.floor(diff / DAY), 'day')} ago`
  return formatDate(iso)
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(iso))
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

/** "45 s", "12 min", "1 h 05 min". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours} h ${String(minutes % 60).padStart(2, '0')} min`
}

export function meetingDuration(startedAt: string, endedAt: string | null, now: number = Date.now()): string {
  const end = endedAt ? Date.parse(endedAt) : now
  return formatDuration(end - Date.parse(startedAt))
}

export type InviteState = 'active' | 'expired' | 'revoked' | 'used'

export function inviteState(invite: RoomInvite, now: number = Date.now()): InviteState {
  if (invite.revoked) return 'revoked'
  if (invite.expiresAt && Date.parse(invite.expiresAt) <= now) return 'expired'
  if (invite.maxUses !== null && invite.useCount >= invite.maxUses) return 'used'
  return 'active'
}

export const INVITE_STATE_LABEL: Record<InviteState, string> = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
  used: 'Used up',
}

/** "Expires in 3 hours", "Expired 2 days ago", "Never expires". */
export function inviteExpiryText(invite: Pick<RoomInvite, 'expiresAt'>, now: number = Date.now()): string {
  if (!invite.expiresAt) return 'Never expires'
  const time = Date.parse(invite.expiresAt)
  const diff = time - now
  if (diff <= 0) return `Expired ${formatRelativeTime(invite.expiresAt, now)}`
  if (diff < HOUR) return `Expires in ${plural(Math.max(1, Math.ceil(diff / MINUTE)), 'minute')}`
  if (diff < DAY) return `Expires in ${plural(Math.ceil(diff / HOUR), 'hour')}`
  return `Expires in ${plural(Math.ceil(diff / DAY), 'day')}`
}

export function inviteUsesText(invite: Pick<RoomInvite, 'useCount' | 'maxUses'>): string {
  if (invite.maxUses === null) return `${plural(invite.useCount, 'use')}`
  return `${invite.useCount} of ${invite.maxUses} uses`
}
