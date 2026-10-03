/**
 * The `/m/<slug>` join flow as a pure reducer (rooms-ui, Stage 04; docs/ARCHITECTURE.md §7). Phase names are the
 * `CallPhase` names:
 *
 *   loading ─► needKey                    (no key in the link, the tab or the vault)
 *           └► info ─► prejoin ─► password (when the room has one) ─► waiting (waiting room) ─► connecting
 *                                          └──────────────────────────────────────────────────► connecting
 *   connecting ─► inCall ─► left | ended | removed | error   (mirrored from the call session)
 *   any step before the call ─► error (full-screen problem with a next step)
 *
 * Retryable join problems (locked, full, rate limited, wrong password, network) stay on the pre-join or password
 * screen as an inline notice; pressing Join again is the retry. `useJoinFlow()` performs the requests and feeds their
 * results back as events; this module only decides what happens next, so every transition is unit-tested.
 */
import type { JoinGrant, JoinInfo, JoinResponse, WaitingEvent } from '#shared/schemas/join'
import type { CallPhase } from '../contracts/call'
import { isInlineJoinProblem, toJoinProblem, type JoinProblem } from './errors'

export interface JoinState {
  phase: CallPhase
  info: JoinInfo | null
  /** The link (or the tab) carries an invite token. */
  hasInvite: boolean
  /** Guest display name entered on the pre-join screen. */
  displayName: string | null
  /** Room password the user entered; sent with every join attempt until the server rejects it. */
  password: string | null
  /** Waiting-room request id (phase `waiting`). */
  requestId: string | null
  /** The LiveKit grant; set once the call starts (`connecting` and later). */
  grant: JoinGrant | null
  /** A join request is running. */
  joining: boolean
  /** Full-screen problem (phase `error` before the call started). */
  problem: JoinProblem | null
  /** Retryable problem shown on the pre-join or password screen. */
  notice: JoinProblem | null
  /** Another tab of this browser is in this meeting; the page offers "Use here". */
  duplicate: boolean
}

export const INITIAL_JOIN_STATE: Readonly<JoinState> = Object.freeze({
  phase: 'loading',
  info: null,
  hasInvite: false,
  displayName: null,
  password: null,
  requestId: null,
  grant: null,
  joining: false,
  problem: null,
  notice: null,
  duplicate: false,
})

export type JoinEvent =
  /** Key resolution finished (`loading`). */
  | { type: 'resolved'; key: 'found' | 'missing' | 'invalid'; supported: boolean; hasInvite: boolean }
  | { type: 'infoLoaded'; info: JoinInfo }
  | { type: 'infoFailed'; code: unknown; retryAfter?: unknown }
  | { type: 'duplicate'; present: boolean }
  | { type: 'joinClicked'; displayName: string | null }
  | { type: 'passwordSubmitted'; password: string }
  | { type: 'passwordBack' }
  | { type: 'joinSucceeded'; response: JoinResponse }
  | { type: 'joinFailed'; code: unknown; retryAfter?: unknown }
  | { type: 'waiting'; event: WaitingEvent }
  | { type: 'waitingFailed' }
  | { type: 'cancelled' }
  /** The call session's phase, once the call started. */
  | { type: 'call'; phase: CallPhase }

/** Phases the call session owns once `connect(grant)` ran. */
const CALL_PHASES: readonly CallPhase[] = ['connecting', 'inCall', 'reconnecting', 'left', 'ended', 'removed', 'error']
const BEFORE_CALL: readonly CallPhase[] = ['loading', 'info', 'prejoin', 'password']

function fail(state: JoinState, problem: JoinProblem): JoinState {
  return { ...state, phase: 'error', problem, notice: null, joining: false, requestId: null }
}

function onInfo(state: JoinState, info: JoinInfo): JoinState {
  const next = { ...state, info }
  if (!info.signedIn && !info.guestsAllowed) return fail(next, { code: 'ROOM_GUESTS_NOT_ALLOWED' })
  // Everyone but the host and co-hosts needs an invite (docs/API.md §6): say so before the camera even opens.
  if (info.yourRole === 'participant' && !state.hasInvite) return fail(next, { code: 'ROOM_INVITE_REQUIRED' })
  return { ...next, phase: 'prejoin' }
}

function onJoinFailed(state: JoinState, problem: JoinProblem): JoinState {
  const base = { ...state, joining: false }
  switch (problem.code) {
    case 'ROOM_PASSWORD_REQUIRED':
      // The password was added after the info request: ask for it now.
      return {
        ...base,
        phase: 'password',
        password: null,
        notice: null,
        info: state.info ? { ...state.info, needsPassword: true } : state.info,
      }
    case 'ROOM_PASSWORD_INVALID':
      return { ...base, phase: 'password', password: null, notice: problem }
    case 'RATE_LIMITED':
      // Wrong-password backoff answers RATE_LIMITED too; keep the person where they were.
      return state.phase === 'password'
        ? { ...base, password: null, notice: problem }
        : { ...base, phase: 'prejoin', notice: problem }
    default:
      return isInlineJoinProblem(problem.code) ? { ...base, phase: 'prejoin', notice: problem } : fail(base, problem)
  }
}

function onWaiting(state: JoinState, event: WaitingEvent): JoinState {
  switch (event.event) {
    case 'status':
      return state
    case 'admitted':
      return { ...state, phase: 'connecting', grant: { status: 'admitted', ...event.data } }
    case 'denied':
      if (event.data.reason === 'locked') {
        // Locking closes the lobby; the person may try again once the host unlocks (stage 04 backend notes).
        return { ...state, phase: 'prejoin', requestId: null, notice: { code: 'ROOM_LOCKED' } }
      }
      return fail(state, { code: event.data.reason === 'removed' ? 'JOIN_REMOVED' : 'JOIN_DENIED' })
    case 'ended':
      return fail(state, { code: 'MEETING_ENDED' })
  }
}

export function joinReducer(state: JoinState, event: JoinEvent): JoinState {
  switch (event.type) {
    case 'resolved': {
      if (state.phase !== 'loading') return state
      const next = { ...state, hasInvite: event.hasInvite }
      if (!event.supported) return fail(next, { code: 'UNSUPPORTED_BROWSER' })
      if (event.key === 'invalid') return fail(next, { code: 'INVALID_LINK' })
      if (event.key === 'missing') return { ...next, phase: 'needKey' }
      return { ...next, phase: 'info' }
    }

    case 'infoLoaded':
      return state.phase === 'info' ? onInfo(state, event.info) : state

    case 'infoFailed':
      return state.phase === 'info' ? fail(state, toJoinProblem(event.code, event.retryAfter)) : state

    case 'duplicate':
      return BEFORE_CALL.includes(state.phase) && !state.joining ? { ...state, duplicate: event.present } : state

    case 'joinClicked': {
      if (state.phase !== 'prejoin' || state.joining || state.duplicate) return state
      const next = { ...state, displayName: event.displayName, notice: null }
      if (state.info?.needsPassword && state.password === null) return { ...next, phase: 'password' }
      return { ...next, joining: true }
    }

    case 'passwordSubmitted':
      if (state.phase !== 'password' || state.joining || event.password.length === 0) return state
      return { ...state, password: event.password, joining: true, notice: null }

    case 'passwordBack':
      return state.phase === 'password' && !state.joining ? { ...state, phase: 'prejoin', notice: null } : state

    case 'joinSucceeded': {
      if (!state.joining) return state
      const base = { ...state, joining: false, notice: null }
      return event.response.status === 'admitted'
        ? { ...base, phase: 'connecting', grant: event.response, requestId: null }
        : { ...base, phase: 'waiting', requestId: event.response.requestId }
    }

    case 'joinFailed':
      return state.joining ? onJoinFailed(state, toJoinProblem(event.code, event.retryAfter)) : state

    case 'waiting':
      return state.phase === 'waiting' ? onWaiting(state, event.event) : state

    case 'waitingFailed':
      return state.phase === 'waiting' ? fail(state, { code: 'UNKNOWN' }) : state

    case 'cancelled':
      return state.phase === 'waiting' ? { ...state, phase: 'prejoin', requestId: null, notice: null } : state

    case 'call':
      if (!state.grant || !CALL_PHASES.includes(event.phase)) return state
      return state.phase === event.phase ? state : { ...state, phase: event.phase }
  }
}

/** The call view (connecting, in call, end screens) is on screen. */
export function inCallView(state: JoinState): boolean {
  return state.grant !== null && CALL_PHASES.includes(state.phase)
}

/** Guests type their name on the pre-join screen; signed-in users join with their profile name. */
export function nameModeFor(info: JoinInfo | null): 'guest' | 'fixed' {
  return info?.signedIn ? 'fixed' : 'guest'
}
