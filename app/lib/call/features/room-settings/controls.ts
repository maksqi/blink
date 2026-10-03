/**
 * Room-wide controls (pure): which controls an actor sees, and the pending state of live settings.
 *
 * Co-hosts get "Lock meeting" and "Mute all"; the host additionally gets the live settings (waiting room, screen
 * share policy, self-unmute, chat) and "End meeting for all". Everything follows `canPerform`; the server enforces.
 */
import type { RoomMetadata } from '#shared/schemas/livekit'
import { canPerform, type CallAction, type CallActor } from '#shared/utils/permissions'

export type LiveSettingKey = 'locked' | 'waitingRoom' | 'screenSharePolicy' | 'allowSelfUnmute' | 'chatEnabled'

export type LiveSettings = Pick<RoomMetadata, LiveSettingKey>

export type RoomControl = LiveSettingKey | 'muteAll' | 'end'

export const LIVE_SETTING_KEYS: readonly LiveSettingKey[] = [
  'locked',
  'waitingRoom',
  'screenSharePolicy',
  'allowSelfUnmute',
  'chatEnabled',
]

/** The `canPerform` action behind each control (`PATCH /settings` uses `call.lock` for `locked` only). */
export function controlAction(control: RoomControl): CallAction {
  switch (control) {
    case 'locked':
      return 'call.lock'
    case 'muteAll':
      return 'call.muteAll'
    case 'end':
      return 'call.end'
    default:
      return 'call.settings'
  }
}

const ORDER: readonly RoomControl[] = [
  'locked',
  'waitingRoom',
  'screenSharePolicy',
  'allowSelfUnmute',
  'chatEnabled',
  'muteAll',
  'end',
]

/** The controls `actor` sees, in display order. */
export function visibleControls(actor: CallActor | null | undefined): RoomControl[] {
  if (!actor) return []
  return ORDER.filter((control) => canPerform(actor, controlAction(control)))
}

/** True when the host-controls button should render at all. */
export function hasRoomControls(actor: CallActor | null | undefined): boolean {
  return visibleControls(actor).length > 0
}

/**
 * Pending live-setting changes are dropped as soon as the server truth (`roomState`) shows the requested value, so a
 * switch shows "pending" only until the `{ state }` response or the metadata update confirms it.
 */
export function settlePending(
  pending: Partial<LiveSettings>,
  state: LiveSettings | null | undefined,
): Partial<LiveSettings> {
  if (!state) return pending
  const next: Partial<LiveSettings> = {}
  let changed = false
  for (const key of LIVE_SETTING_KEYS) {
    if (!(key in pending)) continue
    if (pending[key] === state[key]) {
      changed = true
      continue
    }
    ;(next as Record<string, unknown>)[key] = pending[key]
  }
  return changed ? next : pending
}

/** The value a control shows: the pending request while it is in flight, otherwise the server truth. */
export function displayedSetting<K extends LiveSettingKey>(
  key: K,
  pending: Partial<LiveSettings>,
  state: LiveSettings | null | undefined,
): LiveSettings[K] | undefined {
  if (key in pending) return pending[key] as LiveSettings[K]
  return state?.[key]
}

/**
 * Live-setting requests in flight and their confirmations (pure). The displayed value of a control is
 * 1. the requested value while its `PATCH /settings` is in flight (shown as pending),
 * 2. then the `{ state }` the server answered, until the next room metadata update arrives,
 * 3. otherwise the room metadata (server truth). A failed request falls straight back to the metadata.
 */
export class PendingSettings {
  inflight: Partial<LiveSettings> = {}
  confirmed: Partial<LiveSettings> = {}

  request<K extends LiveSettingKey>(key: K, value: LiveSettings[K]): void {
    this.inflight = { ...this.inflight, [key]: value }
  }

  succeed(key: LiveSettingKey, state: LiveSettings): void {
    this.inflight = without(this.inflight, key)
    this.confirmed = { ...this.confirmed, [key]: state[key] }
  }

  fail(key: LiveSettingKey): void {
    this.inflight = without(this.inflight, key)
  }

  /** A room metadata update: it supersedes every confirmation and settles matching requests. */
  onState(state: LiveSettings | null | undefined): void {
    if (!state) return
    this.confirmed = {}
    this.inflight = settlePending(this.inflight, state)
  }

  isPending(key: LiveSettingKey): boolean {
    return key in this.inflight
  }

  display<K extends LiveSettingKey>(key: K, state: LiveSettings | null | undefined): LiveSettings[K] | undefined {
    if (key in this.inflight) return this.inflight[key] as LiveSettings[K]
    if (key in this.confirmed) return this.confirmed[key] as LiveSettings[K]
    return state?.[key]
  }
}

function without(values: Partial<LiveSettings>, key: LiveSettingKey): Partial<LiveSettings> {
  if (!(key in values)) return values
  return Object.fromEntries(Object.entries(values).filter(([name]) => name !== key)) as Partial<LiveSettings>
}
