/**
 * Typed wrappers over `ctx.callApi` for every in-call route of docs/API.md §7. Request bodies are built with the shared
 * zod schemas. Failures never throw to the caller: the error code maps to `errorMessage(code)` in a toast, and the
 * result says what happened.
 *
 * - `404 NOT_FOUND` on a targeted action means the person already left: "<name> already left the meeting" and the
 *   participant list is refetched.
 * - Lobby decisions on a request another moderator already decided (404 or 409 `CONFLICT`) only refetch; `ROOM_FULL`
 *   is shown.
 * - Every successful action refetches the participant allowances (`onChanged`).
 */
import type { z } from 'zod'
import {
  handSchema,
  liveSettingsSchema,
  muteAllSchema,
  muteSchema,
  permissionsSchema,
  renameSchema,
  roleChangeSchema,
  volumeSchema,
  type CallParticipantInfo,
  type LobbyEntry,
} from '#shared/schemas/calls'
import type { RoomMetadata } from '#shared/schemas/livekit'
import { errorMessage } from '#shared/utils/error-codes'
import type { CallContext } from '../../../contracts/call'

export type LiveSettingsPatch = z.input<typeof liveSettingsSchema>

export type ActionResult<T = void> = { ok: true; value: T } | { ok: false; code: string; status: number }

export interface ActionTarget {
  identity: string
  name: string
}

export interface CallActionsOptions {
  /** Shows an error to the user (defaults to a call toast). */
  notify: (message: string) => void
  /** Called after every successful change (refetch participant allowances). */
  onChanged?: () => void
  /** Called when a target turned out to be gone (refetch participants). */
  onTargetGone?: () => void
  /** Called when a lobby request was already decided elsewhere (refetch the lobby). */
  onLobbyStale?: () => void
}

interface ErrorLike {
  status?: unknown
  code?: unknown
}

function errorInfo(error: unknown): { status: number; code: string } {
  const e = (typeof error === 'object' && error !== null ? error : {}) as ErrorLike
  const status = typeof e.status === 'number' ? e.status : 0
  const code = typeof e.code === 'string' ? e.code : 'INTERNAL'
  return { status, code }
}

/** The user-facing message for a failed call action. */
export function failureMessage(code: string): string {
  if (code === 'NETWORK') return 'Network error. Check your connection.'
  return errorMessage(code)
}

export function goneMessage(target: ActionTarget): string {
  return `${target.name} already left the meeting.`
}

const path = (identity: string, action: string) => `/participants/${encodeURIComponent(identity)}/${action}`

export type CallApi = CallContext['callApi']

export function createCallActions(callApi: CallApi, options: CallActionsOptions) {
  async function run<T>(
    request: () => Promise<T>,
    handle: { target?: ActionTarget; lobby?: boolean; quiet?: boolean; changes?: boolean } = {},
  ): Promise<ActionResult<T>> {
    try {
      const value = await request()
      if (handle.changes !== false) options.onChanged?.()
      return { ok: true, value }
    } catch (error) {
      const { status, code } = errorInfo(error)
      if (handle.lobby && (code === 'NOT_FOUND' || code === 'CONFLICT')) {
        options.onLobbyStale?.()
      } else if (handle.target && code === 'NOT_FOUND') {
        options.notify(goneMessage(handle.target))
        options.onTargetGone?.()
      } else if (!handle.quiet) {
        options.notify(failureMessage(code))
      }
      return { ok: false, code, status }
    }
  }

  const post = <T = void>(url: string, body?: unknown) => callApi<T>(url, { method: 'POST', ...(body === undefined ? {} : { body }) })

  return {
    // ---- Self --------------------------------------------------------------------------------------------------------
    renameSelf: (displayName: string) => run(() => post('/me/name', renameSchema.parse({ displayName }))),
    setHand: (raised: boolean) => run(() => post('/me/hand', handSchema.parse({ raised }))),

    // ---- Reads (quiet: callers keep the last good state) -------------------------------------------------------------
    participants: () =>
      run(
        async () => (await callApi<{ items: CallParticipantInfo[] }>('/participants')).items,
        { quiet: true, changes: false },
      ),
    lobby: () => run(async () => (await callApi<{ items: LobbyEntry[] }>('/lobby')).items, { quiet: true, changes: false }),

    // ---- Waiting room -----------------------------------------------------------------------------------------------
    admit: (requestId: string) =>
      run(() => post(`/lobby/${encodeURIComponent(requestId)}/admit`), { lobby: true, changes: false }),
    deny: (requestId: string) =>
      run(() => post(`/lobby/${encodeURIComponent(requestId)}/deny`), { lobby: true, changes: false }),
    admitAll: () => run(() => post<{ admitted: number }>('/lobby/admit-all'), { lobby: true, changes: false }),

    // ---- One participant ----------------------------------------------------------------------------------------------
    mute: (target: ActionTarget, source: 'microphone' | 'camera' | 'screen_share') =>
      run(() => post(path(target.identity, 'mute'), muteSchema.parse({ source })), { target }),
    setPermissions: (target: ActionTarget, change: { microphone?: boolean; camera?: boolean }) =>
      run(() => post(path(target.identity, 'permissions'), permissionsSchema.parse(change)), { target }),
    askUnmute: (target: ActionTarget) => run(() => post(path(target.identity, 'ask-unmute')), { target, changes: false }),
    setVolume: (target: ActionTarget, level: number) =>
      run(() => post(path(target.identity, 'volume'), volumeSchema.parse({ level: Math.round(level) })), { target }),
    remove: (target: ActionTarget) => run(() => post(path(target.identity, 'remove')), { target }),
    setRole: (target: ActionTarget, role: 'cohost' | 'participant') =>
      run(() => post(path(target.identity, 'role'), roleChangeSchema.parse({ role })), { target }),
    rename: (target: ActionTarget, displayName: string) =>
      run(() => post(path(target.identity, 'name'), renameSchema.parse({ displayName })), { target }),
    lowerHand: (target: ActionTarget) => run(() => post(path(target.identity, 'lower-hand')), { target }),
    /**
     * "Allow to speak" (decision): give the microphone back, lower the hand, then ask to unmute. The person still
     * decides whether to unmute; nothing is forced. Stops at the first failure.
     */
    async allowToSpeak(target: ActionTarget): Promise<ActionResult> {
      const steps = [
        () => post(path(target.identity, 'permissions'), permissionsSchema.parse({ microphone: true })),
        () => post(path(target.identity, 'lower-hand')),
        () => post(path(target.identity, 'ask-unmute')),
      ]
      for (const step of steps) {
        const result = await run(step, { target, changes: false })
        if (!result.ok) {
          options.onChanged?.()
          return result
        }
      }
      options.onChanged?.()
      return { ok: true, value: undefined }
    },

    // ---- Room ---------------------------------------------------------------------------------------------------------
    muteAll: (preventSelfUnmute: boolean) => run(() => post('/mute-all', muteAllSchema.parse({ preventSelfUnmute }))),
    /** One field per request (the UI changes one control at a time). */
    updateSettings: (patch: LiveSettingsPatch) =>
      run(
        async () =>
          (await callApi<{ state: RoomMetadata }>('/settings', { method: 'PATCH', body: liveSettingsSchema.parse(patch) }))
            .state,
        { changes: false },
      ),
    end: () => run(() => post('/end'), { changes: false }),
  }
}

export type CallActions = ReturnType<typeof createCallActions>
