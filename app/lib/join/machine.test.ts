import { describe, expect, it } from 'vitest'
import type { JoinGrant, JoinInfo } from '#shared/schemas/join'
import type { CallPhase } from '../contracts/call'
import { INITIAL_JOIN_STATE, inCallView, joinReducer, nameModeFor, type JoinEvent, type JoinState } from './machine'

const INFO: JoinInfo = {
  roomId: '0190a1b2-c3d4-7e5f-8a9b-00000000000a',
  name: 'Weekly sync',
  needsPassword: false,
  waitingRoom: false,
  recordingActive: false,
  yourRole: 'participant',
  signedIn: false,
  guestsAllowed: true,
  muteOnJoin: false,
}

const GRANT: JoinGrant = {
  status: 'admitted',
  token: 'header.payload.signature',
  url: 'wss://meet.example.com',
  epoch: 'AAAAAAAAAAAAAAAAAAAAAA',
  identity: 'p_0123456789abcdef',
  role: 'participant',
  roomId: INFO.roomId,
}

function run(events: JoinEvent[], from: JoinState = INITIAL_JOIN_STATE): JoinState {
  return events.reduce(joinReducer, from)
}

const toInfo: JoinEvent[] = [{ type: 'resolved', key: 'found', supported: true, hasInvite: true }]
const toPrejoin = (info: Partial<JoinInfo> = {}): JoinEvent[] => [
  ...toInfo,
  { type: 'infoLoaded', info: { ...INFO, ...info } },
]
const clickJoin: JoinEvent = { type: 'joinClicked', displayName: 'Grace' }

describe('loading', () => {
  it('starts in loading with nothing decided', () => {
    expect(INITIAL_JOIN_STATE.phase).toBe('loading')
    expect(Object.isFrozen(INITIAL_JOIN_STATE)).toBe(true)
  })

  it('goes to info when a key was found and remembers whether an invite came with it', () => {
    const state = run(toInfo)
    expect(state.phase).toBe('info')
    expect(state.hasInvite).toBe(true)
    expect(run([{ type: 'resolved', key: 'found', supported: true, hasInvite: false }]).hasInvite).toBe(false)
  })

  it('asks for the key when there is none', () => {
    expect(run([{ type: 'resolved', key: 'missing', supported: true, hasInvite: false }]).phase).toBe('needKey')
  })

  it('reports a damaged key in the link', () => {
    const state = run([{ type: 'resolved', key: 'invalid', supported: true, hasInvite: true }])
    expect(state.phase).toBe('error')
    expect(state.problem).toEqual({ code: 'INVALID_LINK' })
  })

  it('reports an unsupported browser before anything else', () => {
    const state = run([{ type: 'resolved', key: 'invalid', supported: false, hasInvite: false }])
    expect(state.phase).toBe('error')
    expect(state.problem).toEqual({ code: 'UNSUPPORTED_BROWSER' })
  })

  it('resolves only once', () => {
    const state = run([...toInfo, { type: 'resolved', key: 'missing', supported: true, hasInvite: false }])
    expect(state.phase).toBe('info')
  })
})

describe('info', () => {
  it('goes to pre-join with the room info', () => {
    const state = run(toPrejoin())
    expect(state.phase).toBe('prejoin')
    expect(state.info?.name).toBe('Weekly sync')
  })

  it('asks guests to sign in when the room only takes accounts', () => {
    const state = run(toPrejoin({ guestsAllowed: false }))
    expect(state.phase).toBe('error')
    expect(state.problem).toEqual({ code: 'ROOM_GUESTS_NOT_ALLOWED' })
    expect(state.info).not.toBeNull()
    // Signed-in people are not guests.
    expect(run(toPrejoin({ guestsAllowed: false, signedIn: true })).phase).toBe('prejoin')
  })

  it('needs an invite for participants but not for hosts and co-hosts', () => {
    const noInvite: JoinEvent[] = [{ type: 'resolved', key: 'found', supported: true, hasInvite: false }]
    const participant = run([...noInvite, { type: 'infoLoaded', info: INFO }])
    expect(participant.phase).toBe('error')
    expect(participant.problem).toEqual({ code: 'ROOM_INVITE_REQUIRED' })
    for (const yourRole of ['host', 'cohost'] as const) {
      expect(run([...noInvite, { type: 'infoLoaded', info: { ...INFO, yourRole, signedIn: true } }]).phase).toBe(
        'prejoin',
      )
    }
  })

  it.each([
    ['ROOM_KEY_INVALID'],
    ['ROOM_NOT_FOUND'],
    ['ROOM_INVITE_INVALID'],
    ['RATE_LIMITED'],
  ])('shows %s from the info request full-screen', (code) => {
    const state = run([...toInfo, { type: 'infoFailed', code }])
    expect(state.phase).toBe('error')
    expect(state.problem?.code).toBe(code)
  })

  it('keeps the rate-limit wait and maps unknown codes and network errors to UNKNOWN', () => {
    expect(run([...toInfo, { type: 'infoFailed', code: 'RATE_LIMITED', retryAfter: 12.2 }]).problem).toEqual({
      code: 'RATE_LIMITED',
      retryAfter: 13,
    })
    expect(run([...toInfo, { type: 'infoFailed', code: 'NETWORK' }]).problem).toEqual({ code: 'UNKNOWN' })
    expect(run([...toInfo, { type: 'infoFailed', code: 'INTERNAL' }]).problem).toEqual({ code: 'UNKNOWN' })
  })

  it('ignores info results outside the info phase', () => {
    const prejoin = run(toPrejoin())
    expect(joinReducer(prejoin, { type: 'infoLoaded', info: { ...INFO, name: 'Other' } })).toBe(prejoin)
    expect(joinReducer(prejoin, { type: 'infoFailed', code: 'ROOM_NOT_FOUND' })).toBe(prejoin)
  })
})

describe('duplicate tabs', () => {
  it('flags another tab in the meeting before the call starts, and clears it on "Use here"', () => {
    const flagged = run([...toPrejoin(), { type: 'duplicate', present: true }])
    expect(flagged.duplicate).toBe(true)
    // Join is ignored while the other tab still has the meeting.
    expect(joinReducer(flagged, clickJoin)).toBe(flagged)
    const cleared = joinReducer(flagged, { type: 'duplicate', present: false })
    expect(cleared.duplicate).toBe(false)
    expect(joinReducer(cleared, clickJoin).joining).toBe(true)
    expect(run([...toInfo, { type: 'duplicate', present: true }]).duplicate).toBe(true)
  })

  it('ignores the flag once the person is waiting or in the call', () => {
    const waiting = run([...toPrejoin(), clickJoin, { type: 'joinSucceeded', response: { status: 'waiting', requestId: 'r1' } }])
    expect(joinReducer(waiting, { type: 'duplicate', present: true })).toBe(waiting)
  })
})

describe('pre-join and join', () => {
  it('starts the join request with the guest name', () => {
    const state = run([...toPrejoin(), clickJoin])
    expect(state.joining).toBe(true)
    expect(state.displayName).toBe('Grace')
    expect(state.phase).toBe('prejoin')
    // A second click while the request runs does nothing.
    expect(joinReducer(state, clickJoin)).toBe(state)
  })

  it('connects with the grant on 200', () => {
    const state = run([...toPrejoin(), clickJoin, { type: 'joinSucceeded', response: GRANT }])
    expect(state.phase).toBe('connecting')
    expect(state.grant).toEqual(GRANT)
    expect(state.joining).toBe(false)
    expect(inCallView(state)).toBe(true)
  })

  it('waits on 202', () => {
    const state = run([...toPrejoin(), clickJoin, { type: 'joinSucceeded', response: { status: 'waiting', requestId: 'r1' } }])
    expect(state.phase).toBe('waiting')
    expect(state.requestId).toBe('r1')
    expect(inCallView(state)).toBe(false)
  })

  it('ignores results nobody asked for', () => {
    const prejoin = run(toPrejoin())
    expect(joinReducer(prejoin, { type: 'joinSucceeded', response: GRANT })).toBe(prejoin)
    expect(joinReducer(prejoin, { type: 'joinFailed', code: 'ROOM_FULL' })).toBe(prejoin)
    expect(joinReducer(INITIAL_JOIN_STATE, clickJoin)).toBe(INITIAL_JOIN_STATE)
  })

  it.each(['ROOM_LOCKED', 'ROOM_FULL', 'LOBBY_FULL', 'VALIDATION_FAILED', 'NETWORK', 'INTERNAL'])(
    'keeps %s on the pre-join screen, where Join is the retry',
    (code) => {
      const state = run([...toPrejoin(), clickJoin, { type: 'joinFailed', code }])
      expect(state.phase).toBe('prejoin')
      expect(state.joining).toBe(false)
      expect(state.notice?.code).toBe(['NETWORK', 'INTERNAL'].includes(code) ? 'UNKNOWN' : code)
      expect(state.problem).toBeNull()
      const retried = joinReducer(state, clickJoin)
      expect(retried.joining).toBe(true)
      expect(retried.notice).toBeNull()
    },
  )

  it.each([
    'ROOM_KEY_INVALID',
    'ROOM_NOT_FOUND',
    'ROOM_INVITE_REQUIRED',
    'ROOM_INVITE_INVALID',
    'ROOM_GUESTS_NOT_ALLOWED',
    'JOIN_REMOVED',
    'JOIN_DENIED',
  ])('ends the flow on %s', (code) => {
    const state = run([...toPrejoin(), clickJoin, { type: 'joinFailed', code }])
    expect(state.phase).toBe('error')
    expect(state.problem).toEqual({ code })
    expect(state.joining).toBe(false)
  })

  it('shows a rate limit inline with the wait', () => {
    const state = run([...toPrejoin(), clickJoin, { type: 'joinFailed', code: 'RATE_LIMITED', retryAfter: 30 }])
    expect(state.phase).toBe('prejoin')
    expect(state.notice).toEqual({ code: 'RATE_LIMITED', retryAfter: 30 })
  })
})

describe('password', () => {
  const needsPassword = toPrejoin({ needsPassword: true })

  it('asks for the password before sending the join when the room has one', () => {
    const state = run([...needsPassword, clickJoin])
    expect(state.phase).toBe('password')
    expect(state.joining).toBe(false)
  })

  it('sends the password and joins', () => {
    const state = run([...needsPassword, clickJoin, { type: 'passwordSubmitted', password: 'open sesame' }])
    expect(state.joining).toBe(true)
    expect(state.password).toBe('open sesame')
    const joined = joinReducer(state, { type: 'joinSucceeded', response: GRANT })
    expect(joined.phase).toBe('connecting')
  })

  it('ignores an empty password and submissions outside the password phase', () => {
    const state = run([...needsPassword, clickJoin])
    expect(joinReducer(state, { type: 'passwordSubmitted', password: '' })).toBe(state)
    const prejoin = run(needsPassword)
    expect(joinReducer(prejoin, { type: 'passwordSubmitted', password: 'x' })).toBe(prejoin)
  })

  it('asks again after a wrong password', () => {
    const state = run([
      ...needsPassword,
      clickJoin,
      { type: 'passwordSubmitted', password: 'wrong' },
      { type: 'joinFailed', code: 'ROOM_PASSWORD_INVALID' },
    ])
    expect(state.phase).toBe('password')
    expect(state.password).toBeNull()
    expect(state.notice).toEqual({ code: 'ROOM_PASSWORD_INVALID' })
  })

  it('keeps the password backoff on the password screen', () => {
    const state = run([
      ...needsPassword,
      clickJoin,
      { type: 'passwordSubmitted', password: 'wrong' },
      { type: 'joinFailed', code: 'RATE_LIMITED', retryAfter: 4 },
    ])
    expect(state.phase).toBe('password')
    expect(state.notice).toEqual({ code: 'RATE_LIMITED', retryAfter: 4 })
  })

  it('asks for a password that was added after the info request', () => {
    const state = run([...toPrejoin(), clickJoin, { type: 'joinFailed', code: 'ROOM_PASSWORD_REQUIRED' }])
    expect(state.phase).toBe('password')
    expect(state.info?.needsPassword).toBe(true)
    expect(state.notice).toBeNull()
  })

  it('keeps an accepted password for a retry from pre-join', () => {
    const full = run([
      ...needsPassword,
      clickJoin,
      { type: 'passwordSubmitted', password: 'right' },
      { type: 'joinFailed', code: 'ROOM_FULL' },
    ])
    expect(full.phase).toBe('prejoin')
    expect(full.password).toBe('right')
    // The retry goes straight to the request.
    expect(joinReducer(full, clickJoin).joining).toBe(true)
  })

  it('goes back to pre-join', () => {
    const state = run([...needsPassword, clickJoin, { type: 'passwordBack' }])
    expect(state.phase).toBe('prejoin')
    const sending = run([...needsPassword, clickJoin, { type: 'passwordSubmitted', password: 'x' }])
    expect(joinReducer(sending, { type: 'passwordBack' })).toBe(sending)
  })
})

describe('waiting room', () => {
  const waiting = run([...toPrejoin(), clickJoin, { type: 'joinSucceeded', response: { status: 'waiting', requestId: 'r1' } }])
  const { status: _status, ...grantData } = GRANT

  it('stays on status events', () => {
    expect(joinReducer(waiting, { type: 'waiting', event: { event: 'status', data: { status: 'waiting' } } })).toBe(
      waiting,
    )
  })

  it('connects when admitted', () => {
    const state = joinReducer(waiting, { type: 'waiting', event: { event: 'admitted', data: grantData } })
    expect(state.phase).toBe('connecting')
    expect(state.grant).toEqual(GRANT)
  })

  it('ends on denied and removed', () => {
    const denied = joinReducer(waiting, { type: 'waiting', event: { event: 'denied', data: { reason: 'denied' } } })
    expect(denied.phase).toBe('error')
    expect(denied.problem).toEqual({ code: 'JOIN_DENIED' })
    expect(denied.requestId).toBeNull()
    const removed = joinReducer(waiting, { type: 'waiting', event: { event: 'denied', data: { reason: 'removed' } } })
    expect(removed.problem).toEqual({ code: 'JOIN_REMOVED' })
  })

  it('returns to pre-join when the host locks the meeting', () => {
    const state = joinReducer(waiting, { type: 'waiting', event: { event: 'denied', data: { reason: 'locked' } } })
    expect(state.phase).toBe('prejoin')
    expect(state.notice).toEqual({ code: 'ROOM_LOCKED' })
    expect(state.requestId).toBeNull()
  })

  it('ends when the meeting ends', () => {
    const state = joinReducer(waiting, { type: 'waiting', event: { event: 'ended', data: {} } })
    expect(state.phase).toBe('error')
    expect(state.problem).toEqual({ code: 'MEETING_ENDED' })
  })

  it('ends when the stream fails for good', () => {
    const state = joinReducer(waiting, { type: 'waitingFailed' })
    expect(state.phase).toBe('error')
    expect(state.problem).toEqual({ code: 'UNKNOWN' })
  })

  it('goes back to pre-join when the person cancels', () => {
    const state = joinReducer(waiting, { type: 'cancelled' })
    expect(state.phase).toBe('prejoin')
    expect(state.requestId).toBeNull()
  })

  it('ignores waiting events in other phases', () => {
    const prejoin = run(toPrejoin())
    expect(joinReducer(prejoin, { type: 'waiting', event: { event: 'ended', data: {} } })).toBe(prejoin)
    expect(joinReducer(prejoin, { type: 'waitingFailed' })).toBe(prejoin)
    expect(joinReducer(prejoin, { type: 'cancelled' })).toBe(prejoin)
  })
})

describe('in the call', () => {
  const connecting = run([...toPrejoin(), clickJoin, { type: 'joinSucceeded', response: GRANT }])

  it.each<CallPhase>(['inCall', 'reconnecting', 'left', 'ended', 'removed', 'error'])(
    'mirrors the call phase %s',
    (phase) => {
      const state = joinReducer(connecting, { type: 'call', phase })
      expect(state.phase).toBe(phase)
      expect(state.problem).toBeNull()
      expect(inCallView(state)).toBe(true)
    },
  )

  it('ignores call phases before the call and pre-call phases from the session', () => {
    const prejoin = run(toPrejoin())
    expect(joinReducer(prejoin, { type: 'call', phase: 'inCall' })).toBe(prejoin)
    expect(joinReducer(connecting, { type: 'call', phase: 'prejoin' })).toBe(connecting)
    expect(joinReducer(connecting, { type: 'call', phase: 'connecting' })).toBe(connecting)
  })

  it('shows join problems full-screen, not in the call view', () => {
    const failed = run([...toInfo, { type: 'infoFailed', code: 'ROOM_NOT_FOUND' }])
    expect(inCallView(failed)).toBe(false)
  })
})

describe('name mode', () => {
  it('asks guests for a name and shows the profile name of signed-in users', () => {
    expect(nameModeFor(INFO)).toBe('guest')
    expect(nameModeFor({ ...INFO, signedIn: true })).toBe('fixed')
    expect(nameModeFor(null)).toBe('guest')
  })
})
