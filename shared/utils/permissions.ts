/**
 * In-call authorization matrix (docs/SECURITY.md §4). The server is the enforcement point; the UI uses the same
 * function only to decide what to show.
 */
export type CallRole = 'host' | 'cohost' | 'participant'
export type CallKind = 'user' | 'guest'

export const CALL_ACTIONS = [
  'self.rename',
  'self.hand',
  'lobby.view',
  'lobby.admit',
  'lobby.deny',
  'participant.mute',
  'participant.permissions',
  'participant.askUnmute',
  'participant.volume',
  'participant.remove',
  'participant.rename',
  'participant.lowerHand',
  'participant.role',
  'call.muteAll',
  'call.lock',
  'call.settings',
  'call.end',
  'recording.start',
  'recording.stop',
] as const

export type CallAction = (typeof CALL_ACTIONS)[number]

const HOST: readonly CallRole[] = ['host']
const MODERATORS: readonly CallRole[] = ['host', 'cohost']
const EVERYONE: readonly CallRole[] = ['host', 'cohost', 'participant']

const MATRIX: Record<CallAction, readonly CallRole[]> = {
  'self.rename': EVERYONE,
  'self.hand': EVERYONE,
  'lobby.view': MODERATORS,
  'lobby.admit': MODERATORS,
  'lobby.deny': MODERATORS,
  'participant.mute': MODERATORS,
  'participant.permissions': MODERATORS,
  'participant.askUnmute': MODERATORS,
  'participant.volume': MODERATORS,
  'participant.remove': MODERATORS,
  'participant.rename': MODERATORS,
  'participant.lowerHand': MODERATORS,
  // Co-host management is host-only.
  'participant.role': HOST,
  'call.muteAll': MODERATORS,
  'call.lock': MODERATORS,
  // Live room settings (waiting room, screen-share policy, self-unmute, chat) are host-only.
  'call.settings': HOST,
  'call.end': HOST,
  'recording.start': MODERATORS,
  'recording.stop': MODERATORS,
}

/** Actions that target another participant. */
const TARGETED = new Set<CallAction>([
  'participant.mute',
  'participant.permissions',
  'participant.askUnmute',
  'participant.volume',
  'participant.remove',
  'participant.rename',
  'participant.lowerHand',
  'participant.role',
])

/** Actions that need an account (guests can never record). */
const ACCOUNT_ONLY = new Set<CallAction>(['recording.start', 'recording.stop'])

export interface CallActor {
  identity: string
  role: CallRole
  kind: CallKind
}

export interface CallTarget {
  identity: string
  role: CallRole
}

export function canPerform(actor: CallActor, action: CallAction, target?: CallTarget): boolean {
  if (!MATRIX[action].includes(actor.role)) return false
  if (ACCOUNT_ONLY.has(action) && actor.kind !== 'user') return false
  if (TARGETED.has(action)) {
    if (!target) return false
    // Nobody moderates themselves through targeted actions (use self.* actions or leave).
    if (target.identity === actor.identity) return false
    // Nobody acts on the host; co-hosts cannot act on other co-hosts' role.
    if (target.role === 'host') return false
    if (action === 'participant.role' && actor.role !== 'host') return false
  }
  return true
}
