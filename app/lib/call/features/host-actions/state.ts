/**
 * Per-call state of the moderation features (keyed by the `CallContext`, so components, registry callbacks and
 * `setup(ctx)` share it): the action client, the participant-side prompts and the key-rotation reminder.
 */
import { shallowRef, type ShallowRef } from 'vue'
import type { ParticipantRole } from '#shared/schemas/livekit'
import type { CallContext } from '../../../contracts/call'
import { participantInfoStore } from '../participants/useParticipantInfo'
import { createCallActions, type CallActions } from './actions'
import type { NoticeSource } from './notices'
import type { CallUi } from '~/composables/call/useCallUi'
import { callToast } from '~/lib/call/notify'

export interface ServerMuteEvent {
  source: NoticeSource
  seq: number
}

export interface HostActionsState {
  actions: CallActions
  /** The "The host asks you to unmute" prompt is open. */
  askUnmute: ShallowRef<boolean>
  /** The latest server mute of a local track (the notices component brings call-core's toggles in line). */
  serverMuted: ShallowRef<ServerMuteEvent | null>
  /** People this client removed during the call (drives the key-rotation reminder). */
  removedCount: ShallowRef<number>
  /** The local participant's last known role (kept after the call ends, for the end screen). */
  role: ShallowRef<ParticipantRole | null>
  /** The call view's UI state once a call component mounted (panels, dialogs). */
  ui: ShallowRef<CallUi | null>
}

const states = new WeakMap<CallContext, HostActionsState>()

export function hostActionsState(ctx: CallContext): HostActionsState {
  let state = states.get(ctx)
  if (!state) {
    const info = participantInfoStore(ctx)
    state = {
      actions: createCallActions(ctx.callApi, {
        notify: (message) => callToast.error(message),
        onChanged: () => info.refresh(),
        onTargetGone: () => info.refresh(0),
      }),
      askUnmute: shallowRef(false),
      serverMuted: shallowRef(null),
      removedCount: shallowRef(0),
      role: shallowRef(null),
      ui: shallowRef(null),
    }
    states.set(ctx, state)
  }
  return state
}

/** The action client of the call (typed wrappers over `ctx.callApi`). */
export function callActions(ctx: CallContext): CallActions {
  return hostActionsState(ctx).actions
}

/** Opens a side panel of the call view (from toasts and menus); a no-op before the view mounted. */
export function openCallPanel(ctx: CallContext, panelId: string): void {
  const ui = hostActionsState(ctx).ui.value
  if (ui) ui.panel.value = panelId
}
