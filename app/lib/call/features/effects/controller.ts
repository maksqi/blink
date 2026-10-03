/**
 * Video and audio effects of one call session: background blur, noise suppression and own mic gain (Stage 07).
 * Created by the `effects` feature's `setup(ctx)` (pre-join, before the room connects) and found by the components
 * through `effectsFor(useCall())`.
 *
 * - Applies the remembered choices for the devices call-core opens (blur per camera, noise and gain per microphone),
 *   again after every device switch, and remembers every choice the user makes (app/lib/media/preferences.ts).
 * - Blur: `BlurEngine` attaches the processor once and afterwards only switches its mode. In pre-join it waits for the
 *   camera to run, so a load failure never breaks the camera; in a call it attaches right away, so the first published
 *   frame is already processed.
 * - Noise: constraints first (`setMicProcessing`), then the RNNoise insert (`setMicInsert`). RNNoise problems fall
 *   back to browser suppression with a toast. Fallbacks are not remembered (decision): the saved choice is retried in
 *   the next call.
 * - Gain: `AudioControl.setMicGain`; the store's `micGain` is remembered whoever changed it (core's Audio settings too).
 * - CPU warning while blur runs (app/lib/media/cpu-monitor.ts), at most once per call.
 * - Test builds publish `state.media` and `measureNoiseSuppression()` (app/lib/contracts/test-hooks.ts).
 */
import { Track, type LocalVideoTrack } from 'livekit-client'
import { effectScope, reactive, watch, type EffectScope } from 'vue'
import { toast } from 'vue-sonner'
import type { CallContext, CallPhase, MicProcessingConstraints } from '../../../contracts/call'
import { testHooks } from '../../../contracts/test-hooks'
import type { PrefsStorage } from '../../devices'
import { BlurEngine, type CreateBlurProcessor } from '../../../media/blur'
import { micProcessingFor, sameMicProcessing, usesRnnoise } from '../../../media/constraints'
import { CpuMonitor } from '../../../media/cpu-monitor'
import type { BlurLevel, NoiseMode } from '../../../media/levels'
import {
  blurFor,
  micPrefsFor,
  readMediaPrefs,
  rememberBlur,
  rememberMic,
  writeMediaPrefs,
  type MediaPrefs,
  type MicPrefs,
} from '../../../media/preferences'
import {
  createRnnoiseInsert,
  prepareRnnoise,
  RnnoiseUnavailableError,
  type RnnoiseInsert,
  type RnnoiseInsertOptions,
} from '../../../media/rnnoise'
import {
  rnnoiseSampleRateReason,
  supportsBlur,
  supportsRnnoise,
  type EffectSupport,
  type MediaFxEnv,
} from '../../../media/support'

export const BLUR_FAILED = "Background blur isn't available right now"
export const RNNOISE_FAILED = "Enhanced noise suppression isn't available right now. Using browser noise suppression."
export const CPU_WARNING = 'Background blur is using a lot of CPU. Turn it off if your video stutters.'

/** How often the camera sender's `qualityLimitationReason` is sampled while blur runs in a call. */
export const SENDER_STATS_INTERVAL_MS = 2_000

export interface EffectsState {
  blur: BlurLevel
  /** MediaPipe is loading or the processor is starting on the camera ("Loading background blur…"). */
  blurLoading: boolean
  /** The camera runs through the processor and blur is on. */
  blurActive: boolean
  /** Frames the processor blurred (test hook and diagnostics). */
  blurFrames: number
  noise: NoiseMode
  /** A noise-suppression change is being applied. */
  noiseBusy: boolean
  /** The mic chain runs through RNNoise. */
  rnnoiseActive: boolean
  /** Own mic gain, 0..2. */
  gain: number
  blurSupport: EffectSupport
  rnnoiseSupport: EffectSupport
}

/** The parts of the call store the controller reads (reactive). */
export interface EffectsStoreView {
  readonly media: {
    readonly cameraOn: boolean
    readonly cameraBusy: boolean
    readonly cameraError: string | null
    readonly cameraDeviceId: string | null
    readonly micDeviceId: string | null
  }
  readonly micGain: number
}

export interface EffectsNotifier {
  error(message: string): void
  cpuWarning(message: string, turnOff: () => void): void
}

export interface RnnoiseService {
  prepare(context: BaseAudioContext): Promise<void>
  createInsert(options: RnnoiseInsertOptions): RnnoiseInsert
}

export interface EffectsDeps {
  ctx: CallContext
  store: EffectsStoreView
  env: MediaFxEnv
  storage?: PrefsStorage | null
  /** The devices call-core opens first (its remembered choice), known before the tracks exist. */
  expectedDevices?: { videoinput?: string; audioinput?: string }
  createBlurProcessor?: CreateBlurProcessor
  /**
   * Deferred WebGL2 check: `env.hasWebGL2` is then provisional and this runs at idle time or right before blur first
   * starts (creating a context can start the GPU process, which must not slow down the call page start).
   */
  probeWebGL2?: () => boolean
  rnnoise?: RnnoiseService
  notify?: EffectsNotifier
  now?: () => number
}

const CONNECTED: readonly CallPhase[] = ['connecting', 'inCall', 'reconnecting']
const TERMINAL: readonly CallPhase[] = ['left', 'ended', 'removed', 'error']

const callToast = { position: 'top-center' } as const

export const defaultNotifier: EffectsNotifier = {
  error: (message) => toast.error(message, callToast),
  cpuWarning: (message, turnOff) =>
    toast.warning(message, { ...callToast, duration: 15_000, action: { label: 'Turn off', onClick: turnOff } }),
}

const defaultRnnoise: RnnoiseService = { prepare: prepareRnnoise, createInsert: createRnnoiseInsert }

const errorName = (error: unknown) => (error instanceof Error ? error.name : 'error')

export class EffectsController {
  readonly state: EffectsState

  private readonly ctx: CallContext
  private readonly store: EffectsStoreView
  private readonly env: MediaFxEnv
  private readonly storage: PrefsStorage | null
  private readonly notify: EffectsNotifier
  private readonly rnnoise: RnnoiseService
  private readonly now: () => number
  private readonly engine: BlurEngine
  private readonly monitor = new CpuMonitor()
  private readonly scope: EffectScope
  private prefs: MediaPrefs
  private appliedProcessing: MicProcessingConstraints = micProcessingFor('browser') // call-core's default
  private insert: RnnoiseInsert | null = null
  private blurQueue: Promise<unknown> = Promise.resolve()
  private noiseQueue: Promise<unknown> = Promise.resolve()
  private blurCreating = false
  private frameRate: number | null = null
  private timers: Array<ReturnType<typeof setInterval>> = []
  private started = false
  private webglPending: boolean
  private cancelIdleProbe: (() => void) | null = null
  private disposed = false

  constructor(private readonly deps: EffectsDeps) {
    this.ctx = deps.ctx
    this.store = deps.store
    this.env = deps.env
    this.storage = deps.storage ?? null
    this.notify = deps.notify ?? defaultNotifier
    this.rnnoise = deps.rnnoise ?? defaultRnnoise
    this.now = deps.now ?? (() => performance.now())
    this.prefs = readMediaPrefs(this.storage)
    this.webglPending = typeof deps.probeWebGL2 === 'function'
    this.scope = effectScope(true)
    this.state = reactive<EffectsState>({
      blur: 'off',
      blurLoading: false,
      blurActive: false,
      blurFrames: 0,
      noise: 'browser',
      noiseBusy: false,
      rnnoiseActive: false,
      gain: deps.store.micGain,
      blurSupport: supportsBlur(deps.env),
      rnnoiseSupport: supportsRnnoise(deps.env, this.sampleRate()),
    })
    this.engine = new BlurEngine({
      setCameraProcessor: (processor) => this.ctx.media.setCameraProcessor(processor),
      createProcessor: deps.createBlurProcessor,
      onFrameProcessed: (stats) => this.onFrame(stats.processingTimeMs),
    })
  }

  /** Applies the remembered choices and starts following devices and the call phase. Call once. */
  start(): void {
    if (this.started || this.disposed) return
    this.started = true
    const expected = this.deps.expectedDevices ?? {}
    const mic = micPrefsFor(this.prefs, expected.audioinput)
    if (mic.gain !== this.store.micGain) this.ctx.audio.setMicGain(mic.gain)
    this.state.gain = mic.gain
    void this.setNoise(this.usableNoise(mic.noise), { remember: false })
    void this.setBlur(this.usableBlur(blurFor(this.prefs, expected.videoinput)), { remember: false })

    this.scope.run(() => {
      watch(
        () => this.store.media.cameraDeviceId,
        (id) => {
          if (!id) return
          const level = this.usableBlur(blurFor(this.prefs, id))
          if (level !== this.state.blur) void this.setBlur(level, { remember: false })
        },
      )
      watch(
        () => this.store.media.micDeviceId,
        (id) => {
          this.refreshRnnoiseSupport()
          if (!id) return
          const saved = micPrefsFor(this.prefs, id)
          const noise = this.usableNoise(saved.noise)
          if (noise !== this.state.noise) void this.setNoise(noise, { remember: false })
          if (saved.gain !== this.store.micGain) this.ctx.audio.setMicGain(saved.gain)
        },
      )
      watch(
        () => this.store.micGain,
        (gain) => {
          this.state.gain = gain
          this.rememberMic({ gain })
        },
      )
      watch(
        () => [this.store.media.cameraOn, this.store.media.cameraBusy, this.store.media.cameraDeviceId] as const,
        ([cameraOn], [wasOn]) => {
          if (cameraOn !== wasOn) this.monitor.reset()
          // Blur chosen before the camera ran (pre-join): attach now that it does.
          if (this.state.blur !== 'off' && !this.engine.attached && this.cameraLive()) void this.syncBlur()
          this.refreshBlur()
        },
      )
      watch(
        () => this.store.media.cameraError,
        (error) => this.onCameraError(error),
      )
      watch(this.ctx.phase, (phase) => {
        // In a call the processor attaches even while the camera is off (first published frame processed).
        if (CONNECTED.includes(phase) && this.state.blur !== 'off' && !this.engine.attached) void this.syncBlur()
        if (TERMINAL.includes(phase)) this.engine.destroy()
      })
    })

    this.timers.push(setInterval(() => void this.sampleSender(), SENDER_STATS_INTERVAL_MS))
    if (this.webglPending) this.scheduleWebGLCheck()
    if (__BLINQ_TEST_HOOKS__) this.installTestHooks()
  }

  // ---- Actions (components) -------------------------------------------------------------------------------------

  /** Sets the blur level (ignored while unsupported). `remember: false` for automatic changes. */
  async setBlur(level: BlurLevel, options: { remember?: boolean } = {}): Promise<void> {
    if (this.disposed) return
    if (level !== 'off' && !this.state.blurSupport.ok) return
    this.state.blur = level
    if (options.remember !== false) this.rememberBlur(level)
    if (level === 'off') this.monitor.reset()
    this.refreshBlur()
    await this.syncBlur()
  }

  /** "Blur background" on/off: on restores the last level chosen. */
  toggleBlur(): Promise<void> {
    return this.setBlur(this.state.blur === 'off' ? this.prefs.defaults.lastBlur : 'off')
  }

  async setNoise(mode: NoiseMode, options: { remember?: boolean } = {}): Promise<void> {
    if (this.disposed) return
    if (usesRnnoise(mode) && !this.state.rnnoiseSupport.ok) return
    this.state.noise = mode
    if (options.remember !== false) this.rememberMic({ noise: mode })
    await this.syncNoise()
  }

  /** Own mic gain, 0..2 (remembered through the store watcher). */
  setGain(gain: number): void {
    if (this.disposed) return
    this.ctx.audio.setMicGain(gain)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.scope.stop()
    for (const timer of this.timers.splice(0)) clearInterval(timer)
    this.cancelIdleProbe?.()
    this.engine.destroy()
    // The chain disposes the insert when call-core releases the mic; this only detaches it early.
    this.insert?.dispose()
    if (__BLINQ_TEST_HOOKS__) {
      const hooks = testHooks()
      if (hooks) {
        delete hooks.measureNoiseSuppression
        delete hooks.state.media
        delete hooks.state.mediaFx
      }
    }
  }

  // ---- Blur ---------------------------------------------------------------------------------------------------------

  private usableBlur(level: BlurLevel): BlurLevel {
    return this.state.blurSupport.ok ? level : 'off'
  }

  private cameraLive(): boolean {
    return this.store.media.cameraOn && this.ctx.media.cameraTrack() !== null
  }

  private blurRunning(): boolean {
    const processed = this.engine.processedTrack
    return processed !== undefined && this.ctx.media.cameraTrack() === processed
  }

  private refreshBlur(): void {
    const on = this.state.blur !== 'off'
    const running = this.blurRunning()
    this.state.blurActive = on && running
    this.state.blurLoading = on && (this.blurCreating || (this.engine.attached && this.cameraLive() && !running))
  }

  private syncBlur(): Promise<void> {
    return this.enqueue('blur', async () => {
      if (this.disposed) return
      const level = this.state.blur
      const attachNow = this.cameraLive() || CONNECTED.includes(this.ctx.phase.value)
      if (level !== 'off' && !this.engine.attached && !attachNow) return this.refreshBlur()
      if (level === this.engine.level && (level === 'off' || this.engine.attached)) return this.refreshBlur()
      if (level !== 'off' && !this.engine.attached && !this.checkWebGL()) {
        // No WebGL2 after all: the control now shows why; nothing was loaded.
        this.state.blur = 'off'
        return this.refreshBlur()
      }
      this.blurCreating = !this.engine.attached && level !== 'off'
      this.refreshBlur()
      try {
        await this.engine.apply(level)
      } catch (error) {
        this.blurFailed(error)
      } finally {
        this.blurCreating = false
        this.refreshBlur()
      }
    })
  }

  /** Runs the deferred WebGL2 check once; returns whether blur is still supported. */
  private checkWebGL(): boolean {
    if (this.webglPending) {
      this.webglPending = false
      this.cancelIdleProbe?.()
      if (!this.deps.probeWebGL2!()) this.state.blurSupport = supportsBlur({ ...this.env, hasWebGL2: false })
    }
    return this.state.blurSupport.ok
  }

  private scheduleWebGLCheck(): void {
    const run = () => {
      this.cancelIdleProbe = null
      if (!this.disposed) this.checkWebGL()
    }
    const w = globalThis as {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }
    if (w.requestIdleCallback && w.cancelIdleCallback) {
      const handle = w.requestIdleCallback(run, { timeout: 10_000 })
      this.cancelIdleProbe = () => w.cancelIdleCallback!(handle)
    } else {
      const timer = setTimeout(run, 5_000)
      this.cancelIdleProbe = () => clearTimeout(timer)
    }
  }

  private blurFailed(error: unknown): void {
    console.warn('blinq: background blur failed', errorName(error))
    this.state.blur = 'off'
    this.monitor.reset()
    this.refreshBlur()
    this.notify.error(BLUR_FAILED)
  }

  /** The processor attached while the camera was off and the camera then failed to start: blame the processor. */
  private onCameraError(error: string | null): void {
    if (error !== 'failed' || this.state.blur === 'off') return
    if (!this.engine.attached || this.engine.processedTrack !== undefined) return
    void this.enqueue('blur', () => this.engine.reset())
    this.blurFailed(new Error('camera failed to start with the processor'))
  }

  private onFrame(processingTimeMs: number): void {
    if (this.disposed) return
    this.state.blurFrames++
    if (!this.state.blurActive) this.refreshBlur()
    if (this.state.blur === 'off') return
    if (this.monitor.recordFrame(this.now(), processingTimeMs, this.frameRate)) this.warnCpu()
  }

  private async sampleSender(): Promise<void> {
    const track = this.ctx.media.cameraTrack()
    this.frameRate = track?.getSettings().frameRate ?? null
    const room = this.ctx.room.value
    if (!this.state.blurActive || !room || !CONNECTED.includes(this.ctx.phase.value)) return
    const camera = room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack as
      LocalVideoTrack | undefined
    if (!camera) return
    try {
      const layers = await camera.getSenderStats()
      const reason = layers.some((layer) => layer.qualityLimitationReason === 'cpu')
        ? 'cpu'
        : (layers[0]?.qualityLimitationReason ?? 'none')
      if (this.monitor.recordQualityLimitation(this.now(), reason)) this.warnCpu()
    } catch {
      // Stats are best effort.
    }
  }

  private warnCpu(): void {
    this.notify.cpuWarning(CPU_WARNING, () => void this.setBlur('off'))
  }

  // ---- Noise suppression ------------------------------------------------------------------------------------------

  private sampleRate(): number | null {
    try {
      return this.ctx.media.audioContext().sampleRate
    } catch {
      return null
    }
  }

  private usableNoise(mode: NoiseMode): NoiseMode {
    return usesRnnoise(mode) && !this.state.rnnoiseSupport.ok ? 'browser' : mode
  }

  private refreshRnnoiseSupport(): void {
    this.state.rnnoiseSupport = supportsRnnoise(this.env, this.sampleRate())
    this.state.rnnoiseActive = this.insert?.active ?? false
  }

  private applyProcessing(constraints: MicProcessingConstraints): Promise<void> {
    if (sameMicProcessing(constraints, this.appliedProcessing)) return Promise.resolve()
    // call-core stores the constraints before it restarts the mic, so they count as applied even if the restart fails.
    this.appliedProcessing = constraints
    return this.ctx.media.setMicProcessing(constraints).catch((error: unknown) => {
      console.warn('blinq: could not apply microphone processing', errorName(error))
    })
  }

  private syncNoise(): Promise<void> {
    return this.enqueue('noise', async () => {
      if (this.disposed) return
      const mode = this.state.noise
      this.state.noiseBusy = true
      try {
        // Constraints first: before the mic exists they only set what call-core opens it with.
        const processing = this.applyProcessing(micProcessingFor(mode))
        if (usesRnnoise(mode)) {
          try {
            await this.rnnoise.prepare(this.ctx.media.audioContext())
          } catch (error) {
            await processing
            this.rnnoiseFailed(error)
            return
          }
          await processing
          if (this.disposed || this.state.noise !== mode) return
          this.insert ??= this.rnnoise.createInsert({ onError: (error) => this.rnnoiseFailed(error) })
          await this.ctx.media.setMicInsert(this.insert)
        } else {
          await processing
          if (this.insert) {
            // The chain disposes the insert it replaces.
            this.insert = null
            await this.ctx.media.setMicInsert(null)
          }
        }
      } catch (error) {
        console.warn('blinq: could not change noise suppression', errorName(error))
      } finally {
        this.state.noiseBusy = false
        this.refreshRnnoiseSupport()
      }
    })
  }

  private rnnoiseFailed(error: unknown): void {
    if (this.disposed) return
    console.warn('blinq: RNNoise is unavailable', errorName(error))
    if (error instanceof RnnoiseUnavailableError) {
      this.state.rnnoiseSupport = { ok: false, reason: rnnoiseSampleRateReason(error.sampleRate) }
    }
    if (this.insert) {
      this.insert = null
      void this.ctx.media.setMicInsert(null).catch(() => undefined)
    }
    if (this.state.noise !== 'rnnoise') return
    this.state.noise = 'browser'
    this.notify.error(
      error instanceof RnnoiseUnavailableError
        ? `${rnnoiseSampleRateReason(error.sampleRate)}. Using browser noise suppression.`
        : RNNOISE_FAILED,
    )
    void this.syncNoise()
  }

  // ---- Preferences ----------------------------------------------------------------------------------------------

  private rememberBlur(level: BlurLevel): void {
    this.prefs = rememberBlur(this.prefs, this.store.media.cameraDeviceId, level)
    writeMediaPrefs(this.storage, this.prefs)
  }

  private rememberMic(patch: Partial<MicPrefs>): void {
    this.prefs = rememberMic(this.prefs, this.store.media.micDeviceId, patch)
    writeMediaPrefs(this.storage, this.prefs)
  }

  // ---- Internals ------------------------------------------------------------------------------------------------

  private enqueue(kind: 'blur' | 'noise', run: () => Promise<void> | void): Promise<void> {
    const queue = kind === 'blur' ? this.blurQueue : this.noiseQueue
    const next = queue.then(run, run)
    const settled = next.catch(() => undefined)
    if (kind === 'blur') this.blurQueue = settled
    else this.noiseQueue = settled
    return next
  }

  private installTestHooks(): void {
    const hooks = testHooks()
    if (!hooks) return
    hooks.measureNoiseSuppression = () =>
      import('../../../media/noise-measure').then((module) => module.measureNoiseSuppression())
    const publish = () => {
      const local = this.ctx.room.value?.localParticipant
      this.refreshBlur()
      this.state.rnnoiseActive = this.insert?.active ?? false
      hooks.state.media = {
        blur: this.state.blur,
        noise: this.state.noise,
        gain: this.state.gain,
        cameraTrackSid: local?.getTrackPublication(Track.Source.Camera)?.trackSid ?? null,
        micTrackSid: local?.getTrackPublication(Track.Source.Microphone)?.trackSid ?? null,
        blurActive: this.state.blurActive,
        blurLoading: this.state.blurLoading,
        blurFrames: this.state.blurFrames,
        rnnoiseActive: this.state.rnnoiseActive,
        noiseBusy: this.state.noiseBusy,
        sampleRate: this.sampleRate(),
        micProcessing: { ...this.appliedProcessing },
        cameraDeviceId: this.store.media.cameraDeviceId,
        micDeviceId: this.store.media.micDeviceId,
        blurSupport: { ...this.state.blurSupport },
        rnnoiseSupport: { ...this.state.rnnoiseSupport },
      }
    }
    publish()
    this.timers.push(setInterval(publish, 250))
    hooks.state.mediaFx = {
      /**
       * Restarts the published camera track the way a device switch does (`setDeviceId` → `restartTrack`): the fake
       * media of the E2E browsers has a single camera.
       */
      restartCamera: async () => {
        const camera = this.ctx.room.value?.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack as
          LocalVideoTrack | undefined
        await camera?.restartTrack()
      },
    }
  }
}

const controllers = new WeakMap<CallContext, EffectsController>()

export function registerEffects(ctx: CallContext, controller: EffectsController): () => void {
  controllers.set(ctx, controller)
  return () => {
    if (controllers.get(ctx) === controller) controllers.delete(ctx)
  }
}

/** The effects of the surrounding call (null when the feature could not start, e.g. outside the browser). */
export function effectsFor(ctx: CallContext): EffectsController | null {
  return controllers.get(ctx) ?? null
}
