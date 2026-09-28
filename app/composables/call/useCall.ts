import { inject } from 'vue'
import type { CallContext } from '~/lib/contracts/call'
import { CALL_SESSION_KEY } from '~/lib/call/context-key'
import type { CallSession } from '~/lib/call/session'

/**
 * The call session provided by `<CallPrejoin>` / `<CallView>` (core components only; features use `useCall()`).
 * Throws outside the call tree.
 */
export function useCallSession(): CallSession {
  const session = inject(CALL_SESSION_KEY, null)
  if (!session) throw new Error('useCallSession() must be used inside <CallPrejoin> or <CallView>')
  return session
}

/** Everything a call feature may use (`CallContext`, app/lib/contracts/call.ts). */
export function useCall(): CallContext {
  return useCallSession().context
}
