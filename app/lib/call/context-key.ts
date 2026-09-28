/**
 * Injection key for the call session. `<CallPrejoin>` and `<CallView>` provide it; `useCall()` and
 * `useCallSession()` read it. Kept apart from session.ts so components never import the session at runtime.
 */
import type { InjectionKey } from 'vue'
import type { CallSession } from './session'

export const CALL_SESSION_KEY: InjectionKey<CallSession> = Symbol('blinq:call-session')
