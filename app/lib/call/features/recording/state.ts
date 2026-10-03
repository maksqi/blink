/**
 * Per-call recording state for the recording feature: the controller of each call session (keyed by its
 * `CallContext`), the `recording.*` part of `GET /api/config`, the REC announcements everyone gets, the
 * `beforeunload` warning and the test hooks. Components reach it with `recordingFor(useCall())`.
 */
import { effectScope, watch } from 'vue'
import { publicConfigSchema } from '#shared/schemas/settings'
import { canPerform } from '#shared/utils/permissions'
import type { CallContext } from '../../../contracts/call'
import { testHooks } from '../../../contracts/test-hooks'
import { createFrameClock } from '../../../recording/clock'
import { recordingAnnouncement } from '../../../recording/announce'
import { RecordingController, setForcedRecordingMime, type RecordingConfig } from '../../../recording/controller'
import { callToast } from '../../notify'

const controllers = new WeakMap<CallContext, RecordingController>()

export function recordingFor(ctx: CallContext): RecordingController | undefined {
  return controllers.get(ctx)
}

/** Hosts and co-hosts with an account, when the server allows recording. */
export function canRecord(ctx: CallContext): boolean {
  const self = ctx.self.value
  const config = controllers.get(ctx)?.config.value
  if (!self || !config?.enabled) return false
  return canPerform({ identity: self.identity, role: self.role, kind: self.kind }, 'recording.start')
}

async function loadConfig(): Promise<RecordingConfig | null> {
  try {
    const response = await fetch('/api/config', { headers: { accept: 'application/json' }, credentials: 'same-origin' })
    if (!response.ok) return null
    const parsed = publicConfigSchema.safeParse(await response.json())
    return parsed.success ? parsed.data.recording : null
  } catch {
    return null
  }
}

export function attachRecording(ctx: CallContext): (() => void) | undefined {
  if (typeof window === 'undefined') return undefined
  const controller = new RecordingController(ctx, { createClock: () => createFrameClock(), notify: callToast })
  controllers.set(ctx, controller)
  const scope = effectScope(true)

  let configLoading = false
  const ensureConfig = () => {
    if (controller.config.value || configLoading) return
    configLoading = true
    void loadConfig().then((config) => {
      configLoading = false
      if (config) controller.config.value = config
    })
  }
  ensureConfig()

  scope.run(() => {
    watch(
      () => ctx.roomState.value?.recording ?? null,
      (recording) => controller.onIndicator(recording),
      { flush: 'sync' },
    )
    watch(
      () => ctx.phase.value,
      (phase) => {
        controller.onPhase(phase)
        // A failed config load (offline during pre-join) is retried once in the call.
        if (phase === 'inCall') ensureConfig()
      },
    )
    // Toast for everyone; the indicator component carries the aria-live text.
    let seenState = false
    watch(
      () => ctx.roomState.value,
      (state, previous) => {
        if (!state) return
        const initial = !seenState
        seenState = true
        const message = recordingAnnouncement(previous?.recording, state.recording, {
          initial,
          own: controller.state.value.phase !== 'idle',
        })
        if (message) callToast.info(message)
      },
    )
  })

  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!controller.busy) return
    event.preventDefault()
    // Older browsers show the dialog only when returnValue is set.
    event.returnValue = ''
  }
  window.addEventListener('beforeunload', onBeforeUnload)

  if (__BLINQ_TEST_HOOKS__) {
    const hooks = testHooks()
    if (hooks) hooks.forceRecordingMime = (mime) => setForcedRecordingMime(mime)
  }

  return () => {
    window.removeEventListener('beforeunload', onBeforeUnload)
    scope.stop()
    controller.dispose()
    controllers.delete(ctx)
    if (__BLINQ_TEST_HOOKS__) {
      const hooks = testHooks()
      if (hooks) delete hooks.forceRecordingMime
    }
  }
}
