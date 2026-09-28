import { describe, expect, it } from 'vitest'
import { CALL_ACTIONS, canPerform, type CallActor, type CallTarget } from '#shared/utils/permissions'
import { actorOf, decideCallAccess, isTargetedAction } from './authorize'

const host: CallActor = { identity: 'p_host000000000000', role: 'host', kind: 'user' }
const cohost: CallActor = { identity: 'p_cohost0000000000', role: 'cohost', kind: 'user' }
const guestCohost: CallActor = { identity: 'p_gcohost000000000', role: 'cohost', kind: 'guest' }
const participant: CallActor = { identity: 'p_part000000000000', role: 'participant', kind: 'user' }
const guest: CallActor = { identity: 'p_guest00000000000', role: 'participant', kind: 'guest' }

const targets: Record<string, CallTarget> = {
  participant: { identity: 'p_target0000000000', role: 'participant' },
  cohost: { identity: 'p_target1000000000', role: 'cohost' },
  host: { identity: host.identity, role: 'host' },
}

describe('decideCallAccess', () => {
  it('rejects actions a role can never perform before looking at the target', () => {
    for (const actor of [participant, guest]) {
      for (const action of CALL_ACTIONS.filter((a) => !a.startsWith('self.'))) {
        expect(decideCallAccess(actor, action, null), `${actor.role} ${action}`).toBe('forbidden')
      }
    }
    expect(decideCallAccess(cohost, 'participant.role', null)).toBe('forbidden')
    expect(decideCallAccess(cohost, 'call.end')).toBe('forbidden')
    expect(decideCallAccess(cohost, 'call.settings')).toBe('forbidden')
  })

  it('answers not_found for an unknown target of an allowed action', () => {
    expect(decideCallAccess(cohost, 'participant.mute', null)).toBe('not_found')
    expect(decideCallAccess(host, 'participant.role', null)).toBe('not_found')
  })

  it('matches canPerform for every actor, action and target', () => {
    for (const actor of [host, cohost, guestCohost, participant, guest]) {
      for (const action of CALL_ACTIONS) {
        for (const target of [...Object.values(targets), { identity: actor.identity, role: actor.role }]) {
          const expected = canPerform(actor, action, target) ? 'ok' : 'forbidden'
          const decided = decideCallAccess(actor, action, isTargetedAction(action) ? target : undefined)
          expect(decided, `${actor.identity} ${action} → ${target.identity}`).toBe(expected)
        }
      }
    }
  })

  it('never lets anyone act on the host or on themselves', () => {
    for (const actor of [host, cohost]) {
      for (const action of CALL_ACTIONS.filter(isTargetedAction)) {
        expect(decideCallAccess(actor, action, targets.host!)).toBe('forbidden')
        expect(decideCallAccess(actor, action, { identity: actor.identity, role: actor.role })).toBe('forbidden')
      }
    }
  })

  it('classifies targeted actions', () => {
    expect(CALL_ACTIONS.filter(isTargetedAction)).toEqual([
      'participant.mute',
      'participant.permissions',
      'participant.askUnmute',
      'participant.volume',
      'participant.remove',
      'participant.rename',
      'participant.lowerHand',
      'participant.role',
    ])
  })

  it('derives the actor kind from the row', () => {
    expect(actorOf({ lkIdentity: 'p_x', roomRole: 'cohost', userId: 'u' })).toEqual({ identity: 'p_x', role: 'cohost', kind: 'user' })
    expect(actorOf({ lkIdentity: 'p_y', roomRole: 'participant', userId: null }).kind).toBe('guest')
  })
})
