import { describe, expect, it } from 'vitest'
import { canPerform, type CallKind, type CallRole } from '#shared/utils/permissions'
import {
  controlAction,
  hasRoomControls,
  PendingSettings,
  settlePending,
  visibleControls,
  type LiveSettings,
  type RoomControl,
} from './controls'

const actor = (role: CallRole, kind: CallKind = 'user') => ({ identity: 'p_Actor00000000000', role, kind })

const STATE: LiveSettings = {
  locked: false,
  waitingRoom: true,
  screenSharePolicy: 'everyone',
  allowSelfUnmute: true,
  chatEnabled: true,
}

describe('visibleControls', () => {
  it('gives the host every control', () => {
    expect(visibleControls(actor('host'))).toEqual([
      'locked',
      'waitingRoom',
      'screenSharePolicy',
      'allowSelfUnmute',
      'chatEnabled',
      'muteAll',
      'end',
    ])
  })

  it('gives co-hosts lock and mute all only', () => {
    expect(visibleControls(actor('cohost'))).toEqual(['locked', 'muteAll'])
    expect(visibleControls(actor('cohost', 'guest'))).toEqual(['locked', 'muteAll'])
  })

  it('gives participants nothing', () => {
    expect(visibleControls(actor('participant'))).toEqual([])
    expect(hasRoomControls(actor('participant'))).toBe(false)
    expect(hasRoomControls(null)).toBe(false)
    expect(hasRoomControls(actor('cohost'))).toBe(true)
  })

  it('shows a control exactly when canPerform allows its action', () => {
    const all: RoomControl[] = [
      'locked',
      'waitingRoom',
      'screenSharePolicy',
      'allowSelfUnmute',
      'chatEnabled',
      'muteAll',
      'end',
    ]
    for (const role of ['host', 'cohost', 'participant'] as const)
      for (const kind of ['user', 'guest'] as const)
        for (const control of all)
          expect(visibleControls(actor(role, kind)).includes(control)).toBe(
            canPerform(actor(role, kind), controlAction(control)),
          )
  })
})

describe('pending settings', () => {
  it('keeps a pending value until the state confirms it', () => {
    const pending = { locked: true }
    expect(settlePending(pending, STATE)).toEqual({ locked: true })
    expect(settlePending(pending, { ...STATE, locked: true })).toEqual({})
    expect(settlePending(pending, null)).toBe(pending)
  })

  it('settles only the confirmed keys and keeps the same object when nothing changed', () => {
    const pending = { chatEnabled: false, screenSharePolicy: 'hosts' as const }
    expect(settlePending(pending, { ...STATE, chatEnabled: false })).toEqual({ screenSharePolicy: 'hosts' })
    expect(settlePending(pending, STATE)).toBe(pending)
  })
})

describe('PendingSettings', () => {
  it('shows the request while in flight, then the answer until the metadata arrives', () => {
    const pending = new PendingSettings()
    pending.request('locked', true)
    expect(pending.isPending('locked')).toBe(true)
    expect(pending.display('locked', STATE)).toBe(true)
    pending.succeed('locked', { ...STATE, locked: true })
    expect(pending.isPending('locked')).toBe(false)
    expect(pending.display('locked', STATE)).toBe(true)
    pending.onState({ ...STATE, locked: true })
    expect(pending.display('locked', { ...STATE, locked: true })).toBe(true)
    expect(pending.confirmed).toEqual({})
  })

  it('reverts to the server truth on failure', () => {
    const pending = new PendingSettings()
    pending.request('chatEnabled', false)
    pending.fail('chatEnabled')
    expect(pending.display('chatEnabled', STATE)).toBe(true)
    expect(pending.isPending('chatEnabled')).toBe(false)
  })

  it('lets a later metadata update win over a stale confirmation', () => {
    const pending = new PendingSettings()
    pending.request('screenSharePolicy', 'hosts')
    pending.succeed('screenSharePolicy', { ...STATE, screenSharePolicy: 'hosts' })
    // Another host switched it back before our metadata update arrived.
    pending.onState(STATE)
    expect(pending.display('screenSharePolicy', STATE)).toBe('everyone')
  })

  it('settles an in-flight request when the metadata confirms it first', () => {
    const pending = new PendingSettings()
    pending.request('waitingRoom', false)
    pending.onState({ ...STATE, waitingRoom: false })
    expect(pending.isPending('waitingRoom')).toBe(false)
    pending.onState(null)
    expect(pending.display('waitingRoom', { ...STATE, waitingRoom: false })).toBe(false)
  })
})
