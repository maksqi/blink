/**
 * Maps LiveKit disconnect reasons to terminal call phases (pure). docs/stages/05-call-core.md: `Disconnected`
 * reasons map to `removed` / `ended` / `left`; anything unexpected is an `error` the user can retry from.
 */
import { DisconnectReason } from 'livekit-client'
import type { CallPhase } from '../contracts/call'

export type TerminalPhase = Extract<CallPhase, 'left' | 'ended' | 'removed' | 'error'>

export interface DisconnectOutcome {
  phase: TerminalPhase
  /** Short, stable reason for UI copy and tests. */
  reason: 'left' | 'other-tab' | 'removed' | 'ended' | 'connection-lost' | 'server'
}

/** `leaving` is true when this client called `leave()` itself. */
export function outcomeForDisconnect(reason: DisconnectReason | undefined, leaving: boolean): DisconnectOutcome {
  if (leaving) return { phase: 'left', reason: 'left' }
  switch (reason) {
    case DisconnectReason.CLIENT_INITIATED:
      return { phase: 'left', reason: 'left' }
    case DisconnectReason.DUPLICATE_IDENTITY:
      return { phase: 'left', reason: 'other-tab' }
    case DisconnectReason.PARTICIPANT_REMOVED:
      return { phase: 'removed', reason: 'removed' }
    case DisconnectReason.ROOM_DELETED:
    case DisconnectReason.ROOM_CLOSED:
      return { phase: 'ended', reason: 'ended' }
    case DisconnectReason.SERVER_SHUTDOWN:
    case DisconnectReason.MIGRATION:
      return { phase: 'error', reason: 'server' }
    default:
      return { phase: 'error', reason: 'connection-lost' }
  }
}

export const TERMINAL_PHASES: readonly CallPhase[] = ['left', 'ended', 'removed', 'error']

export function isTerminalPhase(phase: CallPhase): boolean {
  return TERMINAL_PHASES.includes(phase)
}
