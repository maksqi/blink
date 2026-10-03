/**
 * Waiting-room state for moderators, one per call (keyed by the `CallContext`). `GET /lobby` is the truth; it is
 * refetched on the `lobby.changed` hint (debounced 150 ms), when the panel opens, after each decision and every 10 s
 * while people wait (decision: a fallback for a lost hint). New arrivals raise a toast with an "Admit" action, stacked
 * into one toast above three people.
 */
import { onMounted, shallowRef, type ShallowRef } from 'vue'
import { toast } from 'vue-sonner'
import type { LobbyEntry } from '#shared/schemas/calls'
import { canPerform } from '#shared/utils/permissions'
import type { CallContext } from '../../../contracts/call'
import { callActions, openCallPanel } from '../host-actions/state'
import { addedEntries, lobbyToastPlan, mergeLobby, withoutEntry } from './lobby-store'
import { useCall } from '~/composables/call'

export const LOBBY_HINT_DEBOUNCE_MS = 150
export const LOBBY_POLL_MS = 10_000

export interface LobbyState {
  readonly entries: ShallowRef<LobbyEntry[]>
  readonly loaded: ShallowRef<boolean>
  /** Requests with a decision in flight. */
  readonly deciding: ShallowRef<ReadonlySet<string>>
  readonly admittingAll: ShallowRef<boolean>
  canView(): boolean
  refresh(delayMs?: number): void
  refreshNow(): Promise<void>
  decide(entry: LobbyEntry, decision: 'admit' | 'deny'): Promise<void>
  admitAll(): Promise<void>
  dispose(): void
}

const SUMMARY_TOAST = 'blinq-lobby-summary'
const entryToast = (requestId: string) => `blinq-lobby-${requestId}`

const states = new WeakMap<CallContext, LobbyState>()

function createLobbyState(ctx: CallContext): LobbyState {
  const entries = shallowRef<LobbyEntry[]>([])
  const loaded = shallowRef(false)
  const deciding = shallowRef<ReadonlySet<string>>(new Set())
  const admittingAll = shallowRef(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let poll: ReturnType<typeof setInterval> | null = null
  let inflight: Promise<void> | null = null
  let again = false
  let disposed = false
  const toasted = new Set<string>()

  const canView = () => {
    const self = ctx.self.value
    return Boolean(self && canPerform({ identity: self.identity, role: self.role, kind: self.kind }, 'lobby.view'))
  }
  const enabled = () => !disposed && ctx.phase.value === 'inCall' && Boolean(ctx.roomId.value) && canView()

  function setDeciding(requestId: string, on: boolean) {
    const next = new Set(deciding.value)
    if (on) next.add(requestId)
    else next.delete(requestId)
    deciding.value = next
  }

  function updatePolling() {
    const want = entries.value.length > 0 && enabled()
    if (want && !poll) poll = setInterval(() => void refreshNow(), LOBBY_POLL_MS)
    if (!want && poll) {
      clearInterval(poll)
      poll = null
    }
  }

  function announce(previous: LobbyEntry[], next: LobbyEntry[]) {
    // Toasts of people who are no longer waiting go away.
    const waiting = new Set(next.map((entry) => entry.requestId))
    for (const requestId of [...toasted]) {
      if (waiting.has(requestId)) continue
      toast.dismiss(entryToast(requestId))
      toasted.delete(requestId)
    }
    if (next.length === 0) toast.dismiss(SUMMARY_TOAST)

    const plan = lobbyToastPlan(addedEntries(previous, next), next.length)
    if (plan.kind === 'each') {
      for (const entry of plan.entries) {
        toasted.add(entry.requestId)
        toast.info(`${entry.displayName} is waiting to join`, {
          id: entryToast(entry.requestId),
          position: 'top-center',
          duration: 15_000,
          action: { label: 'Admit', onClick: () => void decide(entry, 'admit') },
        })
      }
    } else if (plan.kind === 'summary') {
      for (const requestId of [...toasted]) toast.dismiss(entryToast(requestId))
      toasted.clear()
      toast.info(`${plan.count} people are waiting to join`, {
        id: SUMMARY_TOAST,
        position: 'top-center',
        duration: 15_000,
        action: { label: 'View', onClick: () => openCallPanel(ctx, 'lobby') },
      })
    }
  }

  function apply(fetched: LobbyEntry[]) {
    const previous = entries.value
    const next = mergeLobby(previous, fetched)
    if (next !== previous) entries.value = next
    loaded.value = true
    announce(previous, next)
    updatePolling()
  }

  async function refreshNow(): Promise<void> {
    if (!enabled()) {
      updatePolling()
      return
    }
    if (inflight) {
      again = true
      return inflight
    }
    inflight = (async () => {
      do {
        again = false
        const result = await callActions(ctx).lobby()
        if (disposed) return
        if (result.ok) apply(result.value)
      } while (again && enabled())
    })().finally(() => {
      inflight = null
    })
    return inflight
  }

  function refresh(delayMs = LOBBY_HINT_DEBOUNCE_MS) {
    if (disposed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void refreshNow()
    }, delayMs)
  }

  async function decide(entry: LobbyEntry, decision: 'admit' | 'deny') {
    if (deciding.value.has(entry.requestId)) return
    setDeciding(entry.requestId, true)
    try {
      const actions = callActions(ctx)
      const result = decision === 'admit' ? await actions.admit(entry.requestId) : await actions.deny(entry.requestId)
      if (result.ok) {
        const next = withoutEntry(entries.value, entry.requestId)
        announce(entries.value, next)
        entries.value = next
      }
    } finally {
      setDeciding(entry.requestId, false)
      refresh(0)
    }
  }

  async function admitAll() {
    if (admittingAll.value) return
    admittingAll.value = true
    try {
      const result = await callActions(ctx).admitAll()
      if (result.ok) {
        const count = result.value.admitted
        toast.success(count === 1 ? 'Admitted 1 person' : `Admitted ${count} people`, { position: 'top-center' })
      }
    } finally {
      admittingAll.value = false
      refresh(0)
    }
  }

  return {
    entries,
    loaded,
    deciding,
    admittingAll,
    canView,
    refresh,
    refreshNow,
    decide,
    admitAll,
    dispose() {
      disposed = true
      if (timer) clearTimeout(timer)
      if (poll) clearInterval(poll)
      timer = null
      poll = null
      for (const requestId of toasted) toast.dismiss(entryToast(requestId))
      toast.dismiss(SUMMARY_TOAST)
    },
  }
}

export function lobbyState(ctx: CallContext): LobbyState {
  let state = states.get(ctx)
  if (!state) {
    state = createLobbyState(ctx)
    states.set(ctx, state)
  }
  return state
}

/** In the lobby panel: the call's lobby state, refetched when the panel opens. */
export function useLobby(): LobbyState {
  const state = lobbyState(useCall())
  onMounted(() => state.refresh(0))
  return state
}
