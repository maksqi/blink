/**
 * Per-participant moderation menu (pure). Every item is gated by `canPerform(actor, action, target)` from the shared
 * permission matrix plus the target's current state, so the UI offers exactly what the server would allow. The server
 * stays the only enforcement point: a stale menu still gets 403 `CALL_FORBIDDEN` and shows the error.
 */
import type { CallParticipantInfo } from '#shared/schemas/calls'
import { canPerform, type CallAction, type CallActor } from '#shared/utils/permissions'
import type { ParticipantView } from '../../../contracts/call'

export type MenuItemId =
  | 'mute-microphone'
  | 'stop-camera'
  | 'stop-screen-share'
  | 'ask-unmute'
  | 'allow-microphone'
  | 'revoke-microphone'
  | 'allow-camera'
  | 'revoke-camera'
  | 'volume'
  | 'rename'
  | 'make-cohost'
  | 'remove-cohost'
  | 'lower-hand'
  | 'remove'

export type MenuGroup = 'media' | 'permissions' | 'volume' | 'manage' | 'remove'

export interface MenuItem {
  id: MenuItemId
  action: CallAction
  label: string
  group: MenuGroup
  destructive?: boolean
}

/** The target fields the menu needs (a `ParticipantView`, or a subset of it in tests). */
export type MenuTarget = Pick<
  ParticipantView,
  'identity' | 'name' | 'role' | 'micEnabled' | 'cameraEnabled' | 'screenSharing' | 'handRaisedAt'
>

/** Server-side allowances (`GET /participants`); unknown until the first fetch. */
export type MenuInfo = Pick<CallParticipantInfo, 'micAllowed' | 'cameraAllowed'>

const LABELS: Record<MenuItemId, string> = {
  'mute-microphone': 'Mute microphone',
  'stop-camera': 'Stop camera',
  'stop-screen-share': 'Stop screen share',
  'ask-unmute': 'Ask to unmute',
  'allow-microphone': 'Allow microphone',
  'revoke-microphone': 'Take away microphone',
  'allow-camera': 'Allow camera',
  'revoke-camera': 'Take away camera',
  volume: 'Volume for everyone',
  rename: 'Rename',
  'make-cohost': 'Make co-host',
  'remove-cohost': 'Remove co-host',
  'lower-hand': 'Lower hand',
  remove: 'Remove from meeting',
}

/**
 * Whether the target may publish its microphone/camera. Hosts and co-hosts always may (docs/API.md §12); for
 * participants it is the server allowance, or unknown (`undefined`) before the first fetch.
 */
export function publishAllowed(
  target: Pick<MenuTarget, 'role'>,
  info: MenuInfo | null | undefined,
  source: 'microphone' | 'camera',
): boolean | undefined {
  if (target.role !== 'participant') return true
  if (!info) return undefined
  return source === 'microphone' ? info.micAllowed : info.cameraAllowed
}

/**
 * The ordered moderation items `actor` may use on `target`. Nothing targets yourself or the host (`canPerform`), and
 * only the host manages co-hosts. Permission items ("give voice") exist for participants only, once their allowances
 * are known; hosts and co-hosts can always publish.
 */
export function participantMenu(actor: CallActor, target: MenuTarget, info?: MenuInfo | null): MenuItem[] {
  const items: MenuItem[] = []
  const allowed = (action: CallAction) => canPerform(actor, action, { identity: target.identity, role: target.role })
  const add = (id: MenuItemId, action: CallAction, group: MenuGroup, destructive = false) => {
    if (allowed(action)) items.push({ id, action, label: LABELS[id], group, ...(destructive ? { destructive } : {}) })
  }

  if (target.micEnabled) add('mute-microphone', 'participant.mute', 'media')
  if (target.cameraEnabled) add('stop-camera', 'participant.mute', 'media')
  if (target.screenSharing) add('stop-screen-share', 'participant.mute', 'media')
  // Asking makes sense only while muted and while the person may unmute at all.
  if (!target.micEnabled && publishAllowed(target, info, 'microphone') === true) {
    add('ask-unmute', 'participant.askUnmute', 'media')
  }

  if (target.role === 'participant' && info) {
    add(info.micAllowed ? 'revoke-microphone' : 'allow-microphone', 'participant.permissions', 'permissions')
    add(info.cameraAllowed ? 'revoke-camera' : 'allow-camera', 'participant.permissions', 'permissions')
  }

  add('volume', 'participant.volume', 'volume')

  if (target.handRaisedAt !== null) add('lower-hand', 'participant.lowerHand', 'manage')
  add('rename', 'participant.rename', 'manage')
  if (target.role === 'participant') add('make-cohost', 'participant.role', 'manage')
  if (target.role === 'cohost') add('remove-cohost', 'participant.role', 'manage')

  add('remove', 'participant.remove', 'remove', true)
  return items
}
