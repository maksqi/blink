import { describe, expect, it } from 'vitest'
import { CALL_ACTIONS, canPerform, type CallActor, type CallTarget } from './permissions'

const host: CallActor = { identity: 'p_host000000000000', role: 'host', kind: 'user' }
const cohost: CallActor = { identity: 'p_cohost0000000000', role: 'cohost', kind: 'user' }
const guestCohost: CallActor = { identity: 'p_gcohost000000000', role: 'cohost', kind: 'guest' }
const participant: CallActor = { identity: 'p_part000000000000', role: 'participant', kind: 'guest' }
const target: CallTarget = { identity: 'p_target0000000000', role: 'participant' }
const hostTarget: CallTarget = { identity: host.identity, role: 'host' }

describe('call permission matrix', () => {
  it('lets participants do only self actions', () => {
    const allowed = CALL_ACTIONS.filter((a) => canPerform(participant, a, target))
    expect(allowed).toEqual(['self.rename', 'self.hand'])
  })

  it('lets co-hosts moderate but not manage co-hosts, change settings or end the call', () => {
    expect(canPerform(cohost, 'participant.mute', target)).toBe(true)
    expect(canPerform(cohost, 'participant.remove', target)).toBe(true)
    expect(canPerform(cohost, 'lobby.admit')).toBe(true)
    expect(canPerform(cohost, 'call.lock')).toBe(true)
    expect(canPerform(cohost, 'participant.role', target)).toBe(false)
    expect(canPerform(cohost, 'call.settings')).toBe(false)
    expect(canPerform(cohost, 'call.end')).toBe(false)
  })

  it('never allows acting on the host or on yourself via targeted actions', () => {
    expect(canPerform(cohost, 'participant.mute', hostTarget)).toBe(false)
    expect(canPerform(cohost, 'participant.remove', hostTarget)).toBe(false)
    expect(canPerform(host, 'participant.remove', hostTarget)).toBe(false)
    expect(canPerform(host, 'participant.mute')).toBe(false)
  })

  it('lets only account holders record', () => {
    expect(canPerform(host, 'recording.start')).toBe(true)
    expect(canPerform(cohost, 'recording.start')).toBe(true)
    expect(canPerform(guestCohost, 'recording.start')).toBe(false)
    expect(canPerform(participant, 'recording.start')).toBe(false)
  })

  it('lets the host do everything else', () => {
    for (const action of CALL_ACTIONS) {
      expect(canPerform(host, action, target), action).toBe(true)
    }
  })
})
