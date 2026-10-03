import { describe, expect, it } from 'vitest'
import { canPerform, type CallActor, type CallKind, type CallRole } from '#shared/utils/permissions'
import { participantMenu, publishAllowed, type MenuInfo, type MenuItemId, type MenuTarget } from './menu'

const ROLES: CallRole[] = ['host', 'cohost', 'participant']
const KINDS: CallKind[] = ['user', 'guest']

interface TargetState {
  name: string
  micEnabled: boolean
  cameraEnabled: boolean
  screenSharing: boolean
  handRaisedAt: number | null
  info: MenuInfo | null
}

const STATES: TargetState[] = [
  {
    name: 'all on',
    micEnabled: true,
    cameraEnabled: true,
    screenSharing: true,
    handRaisedAt: 1,
    info: { micAllowed: true, cameraAllowed: true },
  },
  {
    name: 'all off',
    micEnabled: false,
    cameraEnabled: false,
    screenSharing: false,
    handRaisedAt: null,
    info: { micAllowed: true, cameraAllowed: true },
  },
  {
    name: 'revoked',
    micEnabled: false,
    cameraEnabled: false,
    screenSharing: false,
    handRaisedAt: 5,
    info: { micAllowed: false, cameraAllowed: false },
  },
  {
    name: 'unknown allowances',
    micEnabled: false,
    cameraEnabled: true,
    screenSharing: false,
    handRaisedAt: null,
    info: null,
  },
]

const actorOf = (role: CallRole, kind: CallKind): CallActor => ({ identity: 'p_Actor00000000000', role, kind })

function targetOf(role: CallRole, state: TargetState, identity = 'p_Target0000000000'): MenuTarget {
  return {
    identity,
    name: 'Tara',
    role,
    micEnabled: state.micEnabled,
    cameraEnabled: state.cameraEnabled,
    screenSharing: state.screenSharing,
    handRaisedAt: state.handRaisedAt,
  }
}

/** The expected item ids, written out independently of the implementation. */
function expected(actor: CallActor, target: MenuTarget, info: MenuInfo | null): MenuItemId[] {
  const can = (action: Parameters<typeof canPerform>[1]) => canPerform(actor, action, target)
  const micAllowed = target.role !== 'participant' ? true : info?.micAllowed
  const ids: MenuItemId[] = []
  if (target.micEnabled && can('participant.mute')) ids.push('mute-microphone')
  if (target.cameraEnabled && can('participant.mute')) ids.push('stop-camera')
  if (target.screenSharing && can('participant.mute')) ids.push('stop-screen-share')
  if (!target.micEnabled && micAllowed === true && can('participant.askUnmute')) ids.push('ask-unmute')
  if (target.role === 'participant' && info && can('participant.permissions')) {
    ids.push(info.micAllowed ? 'revoke-microphone' : 'allow-microphone')
    ids.push(info.cameraAllowed ? 'revoke-camera' : 'allow-camera')
  }
  if (can('participant.volume')) ids.push('volume')
  if (target.handRaisedAt !== null && can('participant.lowerHand')) ids.push('lower-hand')
  if (can('participant.rename')) ids.push('rename')
  if (target.role === 'participant' && can('participant.role')) ids.push('make-cohost')
  if (target.role === 'cohost' && can('participant.role')) ids.push('remove-cohost')
  if (can('participant.remove')) ids.push('remove')
  return ids
}

describe('participantMenu', () => {
  for (const actorRole of ROLES)
    for (const kind of KINDS)
      for (const targetRole of ROLES)
        for (const state of STATES) {
          it(`${actorRole} (${kind}) → ${targetRole}, ${state.name}`, () => {
            const actor = actorOf(actorRole, kind)
            const target = targetOf(targetRole, state)
            const items = participantMenu(actor, target, state.info)
            expect(items.map((item) => item.id)).toEqual(expected(actor, target, state.info))
            // Every offered item is allowed by the shared matrix for exactly this target.
            for (const item of items) expect(canPerform(actor, item.action, target)).toBe(true)
          })
        }

  it('offers nothing on yourself', () => {
    for (const role of ROLES) {
      const actor = actorOf(role, 'user')
      const self = targetOf('participant', STATES[0]!, actor.identity)
      expect(participantMenu(actor, self, STATES[0]!.info)).toEqual([])
    }
  })

  it('offers nothing on the host', () => {
    for (const role of ROLES) {
      for (const state of STATES)
        expect(participantMenu(actorOf(role, 'user'), targetOf('host', state), state.info)).toEqual([])
    }
  })

  it('offers participants nothing at all', () => {
    for (const targetRole of ROLES)
      for (const state of STATES)
        expect(participantMenu(actorOf('participant', 'user'), targetOf(targetRole, state), state.info)).toEqual([])
  })

  it('never lets co-hosts manage co-hosts', () => {
    for (const targetRole of ROLES)
      for (const state of STATES) {
        const ids = participantMenu(actorOf('cohost', 'user'), targetOf(targetRole, state), state.info).map((i) => i.id)
        expect(ids).not.toContain('make-cohost')
        expect(ids).not.toContain('remove-cohost')
      }
  })

  it('lets the host promote participants and demote co-hosts', () => {
    const host = actorOf('host', 'user')
    expect(participantMenu(host, targetOf('participant', STATES[1]!)).map((i) => i.id)).toContain('make-cohost')
    expect(participantMenu(host, targetOf('cohost', STATES[1]!)).map((i) => i.id)).toContain('remove-cohost')
  })

  it('orders the items and marks removal as destructive', () => {
    const items = participantMenu(actorOf('host', 'user'), targetOf('participant', STATES[0]!), STATES[0]!.info)
    expect(items.map((i) => i.id)).toEqual([
      'mute-microphone',
      'stop-camera',
      'stop-screen-share',
      'revoke-microphone',
      'revoke-camera',
      'volume',
      'lower-hand',
      'rename',
      'make-cohost',
      'remove',
    ])
    expect(items.at(-1)).toMatchObject({ id: 'remove', destructive: true, label: 'Remove from meeting' })
  })

  it('asks a muted co-host to unmute (co-hosts can always publish)', () => {
    const ids = participantMenu(actorOf('host', 'user'), targetOf('cohost', STATES[1]!), null).map((i) => i.id)
    expect(ids).toContain('ask-unmute')
    expect(ids).not.toContain('allow-microphone')
  })
})

describe('publishAllowed', () => {
  it('is always true for hosts and co-hosts and the allowance for participants', () => {
    expect(publishAllowed({ role: 'cohost' }, null, 'microphone')).toBe(true)
    expect(publishAllowed({ role: 'participant' }, null, 'microphone')).toBeUndefined()
    expect(publishAllowed({ role: 'participant' }, { micAllowed: false, cameraAllowed: true }, 'microphone')).toBe(
      false,
    )
    expect(publishAllowed({ role: 'participant' }, { micAllowed: false, cameraAllowed: true }, 'camera')).toBe(true)
  })
})
