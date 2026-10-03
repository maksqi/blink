/**
 * The `/m/<slug>` join flow (rooms-ui, Stage 04): runs the requests and side effects of the pure reducer in
 * app/lib/join/machine.ts and hands off to call-core (`createCallSession`, `session.connect(grant)`).
 *
 *   loading   K and t from the fragment (`$fragment.take`), this tab's key or the key vault; the per-tab clientId
 *   info      POST /api/join/:slug/info (proof only) + GET /api/config + the duplicate-tab probe, in parallel
 *   prejoin   the call session is created here (SDK, E2EE worker, preview); `<CallPrejoin>` emits join
 *   password  when the room has one
 *   join      POST /api/join/:slug → 200 grant → connect, or 202 → waiting (EventSource; cancel)
 *   connecting → inCall → left | ended | removed | error   (phases of the call session, mirrored)
 *
 * The key K stays in this composable and the call session: only the join proof is sent, and nothing secret is ever
 * put in a URL. Must be called from a component's setup; `start()` runs on the client (the page calls it on mount).
 */
import { onBeforeUnmount, shallowRef } from 'vue'
import type { JoinInfo, JoinResponse } from '#shared/schemas/join'
import type { PublicConfig } from '#shared/schemas/settings'
import { callToast } from '~/lib/call/notify'
import { createCallSession, type ApiClient, type CallSession } from '~/lib/call/session'
import type { CallPhase } from '~/lib/contracts/call'
import { testHooks } from '~/lib/contracts/test-hooks'
import { deriveJoinProof, encodeRoomKey, isValidSlug, type RoomKey } from '~/lib/e2ee/keys'
import { currentBrowserEnv, evaluateCallSupport } from '~/lib/livekit/support'
import { newClientId, tabClientId } from '~/lib/join/client-id'
import { resolveRoomKey } from '~/lib/join/key-source'
import { INITIAL_JOIN_STATE, joinReducer, type JoinEvent, type JoinState } from '~/lib/join/machine'
import { presenceChannelName, TabPresence, type ChannelLike } from '~/lib/join/tab-presence'
import { openWaitingStream, type WaitingStream } from '~/lib/join/waiting'
import { signInLocation } from '../useAuth'
import { ApiError } from '../useApi'
import { useKeyVault } from './useKeyVault'

/** How long a new tab listens for a tab of the same meeting that is already in the call. */
const PROBE_MS = 250
/** How long "Use here" waits for the other tab to confirm that it left. */
const LEAVE_TIMEOUT_MS = 3_000
const LIVE_PHASES: readonly CallPhase[] = ['connecting', 'inCall', 'reconnecting']
const HOST_PAGE_PHASES: readonly CallPhase[] = ['prejoin', 'password', 'waiting']

function errorCode(error: unknown): { code: unknown; retryAfter?: unknown } {
  if (error instanceof ApiError) {
    const details = error.details as { retryAfter?: unknown } | undefined
    return { code: error.code, retryAfter: details?.retryAfter }
  }
  return { code: 'UNKNOWN' }
}

function openChannel(slug: string): ChannelLike | null {
  try {
    if (typeof BroadcastChannel !== 'function') return null
    return new BroadcastChannel(presenceChannelName(slug)) as unknown as ChannelLike
  } catch {
    return null
  }
}

export function useJoinFlow(slug: string) {
  const nuxtApp = useNuxtApp()
  const api = useApi()
  const user = useAuthState()
  const vault = useKeyVault()
  // The dashboard and the auth pages may have loaded GET /api/config already.
  const cachedConfig = useNuxtData<PublicConfig>('blinq:public-config').data

  const state = shallowRef<JoinState>(INITIAL_JOIN_STATE)
  const session = shallowRef<CallSession | null>(null)
  const config = shallowRef<PublicConfig | null>(null)
  /** "Use here" is waiting for the other tab. */
  const takingOver = shallowRef(false)

  let key: RoomKey | null = null
  let inviteToken: string | undefined
  let proof: string | null = null
  let clientId: string | null = null
  let stream: WaitingStream | null = null
  let presence: TabPresence | null = null
  let otherTab: string | null = null
  let disposed = false

  function publishTestState(next: JoinState) {
    if (!__BLINQ_TEST_HOOKS__) return
    const hooks = testHooks()
    if (hooks) {
      hooks.state.join = {
        phase: next.phase,
        problem: next.problem?.code ?? null,
        notice: next.notice?.code ?? null,
        requestId: next.requestId,
        duplicate: next.duplicate,
        /** Graceful leave for test teardown (a live connection torn down abruptly makes the SDK log errors). */
        leave: () => session.value?.leave(),
      }
    }
  }

  function currentPhase(): CallPhase {
    return state.value.phase
  }

  function dispatch(event: JoinEvent) {
    if (disposed) return
    const next = joinReducer(state.value, event)
    if (next === state.value) return
    state.value = next
    // The call session shows the phases the page owns too (test hooks, features reading ctx.phase).
    if (session.value && HOST_PAGE_PHASES.includes(next.phase)) session.value.setPhase(next.phase)
    publishTestState(next)
  }

  // ---- loading and info ------------------------------------------------------------------------------------------

  async function start() {
    if (!import.meta.client || state.value.phase !== 'loading') return
    publishTestState(state.value)
    const fragment = nuxtApp.$fragment.take(`/m/${slug}`)
    const supported = evaluateCallSupport(currentBrowserEnv()).ok
    clientId = tabClientId(() => window.sessionStorage)

    if (!isValidSlug(slug)) {
      dispatch({ type: 'resolved', key: 'found', supported, hasInvite: false })
      dispatch({ type: 'infoFailed', code: 'ROOM_NOT_FOUND' })
      return
    }
    const resolved = resolveRoomKey({
      fragment,
      tab: vault.tab.get(slug),
      vault: user.value ? vault.findBySlug(slug) : null,
    })
    if (resolved.status === 'found') {
      key = resolved.key
      inviteToken = resolved.inviteToken
      // Reloads and sign-in round trips of this tab keep working after the fragment was stripped.
      vault.tab.save(slug, { key, inviteToken })
    }
    dispatch({
      type: 'resolved',
      key: resolved.status,
      supported,
      hasInvite: resolved.status === 'found' && Boolean(inviteToken),
    })
    // dispatch() moved the state on; read it again rather than relying on the narrowed type above.
    if (currentPhase() === 'info') await loadInfo()
  }

  async function loadConfig(): Promise<PublicConfig | null> {
    if (cachedConfig.value) return cachedConfig.value
    try {
      return await api<PublicConfig>('/api/config')
    } catch {
      return null // the session falls back to default media limits and this origin
    }
  }

  async function loadInfo() {
    if (!key) return
    proof = await deriveJoinProof(key, slug)
    presence = new TabPresence({
      channel: openChannel(slug),
      id: newClientId(),
      inCall: () => LIVE_PHASES.includes(state.value.phase),
      onLeaveRequest: leaveForOtherTab,
    })
    const [info, publicConfig, other] = await Promise.allSettled([
      api<JoinInfo>(`/api/join/${slug}/info`, {
        method: 'POST',
        body: { proof, ...(inviteToken ? { inviteToken } : {}) },
      }),
      loadConfig(),
      presence.probe(PROBE_MS),
    ])
    if (disposed) return
    config.value = publicConfig.status === 'fulfilled' ? publicConfig.value : null
    if (other.status === 'fulfilled' && other.value) {
      otherTab = other.value
      dispatch({ type: 'duplicate', present: true })
    }
    if (info.status === 'rejected') {
      dispatch({ type: 'infoFailed', ...errorCode(info.reason) })
      return
    }
    dispatch({ type: 'infoLoaded', info: info.value })
    void rememberKey(info.value)
    ensureSession()
  }

  /** Hosts and co-hosts keep the key in their vault, so the dashboard can build links (docs/SECURITY.md §3.1). */
  async function rememberKey(info: JoinInfo) {
    if (!key || !user.value || (info.yourRole !== 'host' && info.yourRole !== 'cohost')) return
    const stored = vault.get(info.roomId)
    if (stored && encodeRoomKey(stored.key) === encodeRoomKey(key)) return
    try {
      const room = await api<{ room: { id: string; slug: string; keyVersion: number } }>(
        `/api/rooms/${encodeURIComponent(info.roomId)}`,
      )
      // The proof was just accepted, so this key is the room's current one.
      if (key) vault.save({ roomId: room.room.id, slug: room.room.slug, key, keyVersion: room.room.keyVersion })
    } catch {
      // Not critical: the meeting works without the vault entry.
    }
  }

  /** Creates the call session for pre-join (SDK, E2EE worker, connection warm-up); never for an error screen. */
  function ensureSession() {
    const { info, phase, duplicate } = state.value
    if (session.value || !key || !info || duplicate || disposed) return
    if (phase !== 'prejoin' && phase !== 'password') return
    const cfg = config.value
    const created = createCallSession({
      slug,
      key,
      media: cfg?.media,
      publicUrl: cfg?.publicUrl,
      livekitUrl: cfg?.livekitUrl,
      muteOnJoin: info.muteOnJoin,
      api: api as unknown as ApiClient,
    })
    created.events.on('call.phase', (phase) => dispatch({ type: 'call', phase }))
    session.value = created
    if (HOST_PAGE_PHASES.includes(state.value.phase)) created.setPhase(state.value.phase)
  }

  // ---- join --------------------------------------------------------------------------------------------------------

  function join(payload: { displayName: string | null }) {
    dispatch({ type: 'joinClicked', displayName: payload.displayName })
    if (state.value.joining) void sendJoin()
  }

  function submitPassword(password: string) {
    dispatch({ type: 'passwordSubmitted', password })
    if (state.value.joining) void sendJoin()
  }

  function backFromPassword() {
    dispatch({ type: 'passwordBack' })
  }

  async function sendJoin() {
    const current = state.value
    if (!proof || !clientId) return
    const body = {
      proof,
      clientId,
      ...(inviteToken ? { inviteToken } : {}),
      // Signed-in people join with their profile name; only guests send one.
      ...(!current.info?.signedIn && current.displayName ? { displayName: current.displayName } : {}),
      ...(current.password ? { password: current.password } : {}),
    }
    let response: JoinResponse
    try {
      response = await api<JoinResponse>(`/api/join/${slug}`, { method: 'POST', body })
    } catch (error) {
      dispatch({ type: 'joinFailed', ...errorCode(error) })
      return
    }
    dispatch({ type: 'joinSucceeded', response })
    afterDecision()
  }

  /** Connects once the flow reached `connecting`, or listens in the waiting room. */
  function afterDecision() {
    const current = state.value
    if (current.phase === 'connecting' && current.grant) {
      stream?.close()
      stream = null
      void session.value?.connect(current.grant)
    } else if (current.phase === 'waiting' && current.requestId && !stream) {
      openStream(current.requestId)
    }
  }

  // ---- waiting room ------------------------------------------------------------------------------------------------

  function openStream(requestId: string) {
    stream = openWaitingStream(requestId, {
      onEvent: (event) => {
        if (event.event !== 'status') stream = null
        dispatch({ type: 'waiting', event })
        afterDecision()
      },
      onFailure: () => {
        stream = null
        dispatch({ type: 'waitingFailed' })
      },
    })
  }

  async function cancelWaiting() {
    const requestId = state.value.requestId
    if (!requestId) return
    stream?.close()
    stream = null
    try {
      await api(`/api/join/requests/${encodeURIComponent(requestId)}/cancel`, { method: 'POST' })
    } catch {
      // Waiting requests expire on the server; the person is out of the waiting room either way.
    }
    dispatch({ type: 'cancelled' })
  }

  // ---- duplicate tabs ----------------------------------------------------------------------------------------------

  async function takeOver() {
    if (!presence || takingOver.value) return
    takingOver.value = true
    try {
      if (otherTab) await presence.requestLeave(otherTab, LEAVE_TIMEOUT_MS)
    } finally {
      takingOver.value = false
    }
    otherTab = null
    dispatch({ type: 'duplicate', present: false })
    ensureSession()
  }

  async function leaveForOtherTab() {
    const current = session.value
    if (!current || !LIVE_PHASES.includes(state.value.phase)) return
    callToast.info('You joined this meeting in another tab, so this tab left it.')
    await current.leave()
  }

  // ---- next steps --------------------------------------------------------------------------------------------------

  /** Starts over with a fresh page: the key is in this tab, and a call session connects only once. */
  function reload() {
    window.location.reload()
  }

  function signIn() {
    return navigateTo(signInLocation(`/m/${slug}`))
  }

  function dispose() {
    disposed = true
    stream?.close()
    stream = null
    presence?.close()
    presence = null
    session.value?.dispose()
    if (__BLINQ_TEST_HOOKS__) {
      const hooks = testHooks()
      if (hooks) delete hooks.state.join
    }
  }

  onBeforeUnmount(dispose)

  return {
    state,
    session,
    config,
    takingOver,
    start,
    join,
    submitPassword,
    backFromPassword,
    cancelWaiting,
    takeOver,
    reload,
    signIn,
  }
}
