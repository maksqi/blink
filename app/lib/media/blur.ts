/**
 * Background blur with the @livekit/track-processors 0.8 `BackgroundProcessor`, attached through call-core's
 * `MediaControl.setCameraProcessor` (call-core keeps it on the current and every later camera track).
 *
 * - One processor per call page, created on the first enable with `mode: 'disabled'`, the self-hosted asset paths and
 *   `maxFps: 30` (the canvas fallback of Firefox and Safari). The library and MediaPipe load only then.
 * - Afterwards only `switchTo()` changes the level (`background-blur` with a radius, or `disabled`). Turning blur off
 *   never calls `stopProcessor()` and nothing here ever publishes or unpublishes: `setProcessor` swaps the sender
 *   track with `replaceTrack`, so peers keep the same publication.
 * - A load or init failure removes the processor again (the camera keeps sending unprocessed video) and rejects.
 * - `destroy()` on leave.
 */
import type { Track, TrackProcessor } from 'livekit-client'
import { BLUR_RADIUS, type BlurLevel, type BlurOnLevel } from './levels'
import { BLUR_ASSET_PATHS } from './vendor-paths'

export interface BlurFrameStats {
  processingTimeMs: number
}

export type BlurSwitchOptions = { mode: 'disabled' } | { mode: 'background-blur'; blurRadius: number }

/** The part of the library's `BackgroundProcessorWrapper` blinq uses. */
export interface BlurProcessor extends TrackProcessor<Track.Kind.Video> {
  switchTo(options: BlurSwitchOptions): Promise<void>
}

export type CreateBlurProcessor = (onFrameProcessed: (stats: BlurFrameStats) => void) => Promise<BlurProcessor>

export const BLUR_MAX_FPS = 30

/** Loads the library on demand (it pulls in MediaPipe) and creates the processor in `disabled` mode. */
export const createBackgroundProcessor: CreateBlurProcessor = async (onFrameProcessed) => {
  const { BackgroundProcessor, supportsBackgroundProcessors } = await import('@livekit/track-processors')
  if (!supportsBackgroundProcessors()) throw new Error('Background processors are not supported in this browser')
  return BackgroundProcessor({
    mode: 'disabled',
    assetPaths: { ...BLUR_ASSET_PATHS },
    maxFps: BLUR_MAX_FPS,
    onFrameProcessed,
  }) as unknown as BlurProcessor
}

export function blurSwitchOptions(level: BlurLevel): BlurSwitchOptions {
  return level === 'off'
    ? { mode: 'disabled' }
    : { mode: 'background-blur', blurRadius: BLUR_RADIUS[level as BlurOnLevel] }
}

export interface BlurEngineOptions {
  setCameraProcessor: (processor: TrackProcessor<Track.Kind.Video> | null) => Promise<void>
  createProcessor?: CreateBlurProcessor
  onFrameProcessed?: (stats: BlurFrameStats) => void
}

export class BlurEngine {
  private processor: BlurProcessor | null = null
  private applied: BlurLevel = 'off'
  private queue: Promise<unknown> = Promise.resolve()
  private destroyed = false
  private readonly createProcessor: CreateBlurProcessor

  constructor(private readonly options: BlurEngineOptions) {
    this.createProcessor = options.createProcessor ?? createBackgroundProcessor
  }

  /** The level last applied successfully. */
  get level(): BlurLevel {
    return this.applied
  }

  /** True once a processor is attached (it may still wait for the camera to start before it initializes). */
  get attached(): boolean {
    return this.processor !== null
  }

  /** The processor's output track once initialized (what call-core sends while the camera is on). */
  get processedTrack(): MediaStreamTrack | undefined {
    return this.processor?.processedTrack
  }

  /**
   * Applies a level (calls are serialized). The first non-off level loads, creates and attaches the processor; every
   * later change only switches its mode. Rejects when loading or initializing fails; the processor is removed again.
   */
  apply(level: BlurLevel): Promise<void> {
    return this.enqueue(() => this.applyNow(level))
  }

  /**
   * Removes a processor that could not initialize (for example after the camera failed to start with it), so the
   * camera works unprocessed again. The next non-off level creates a new one.
   */
  reset(): Promise<void> {
    return this.enqueue(async () => {
      const processor = this.processor
      if (processor) await this.detach(processor)
      this.applied = 'off'
    })
  }

  /** On leave: stops the processor for good (call-core stops the camera track itself). */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    const processor = this.processor
    this.processor = null
    void Promise.resolve()
      .then(() => processor?.destroy())
      .catch(() => undefined)
  }

  private async applyNow(level: BlurLevel): Promise<void> {
    if (this.destroyed) return
    const options = blurSwitchOptions(level)
    if (this.processor) {
      await this.processor.switchTo(options)
      this.applied = level
      return
    }
    if (level === 'off') {
      this.applied = 'off'
      return
    }
    const processor = await this.createProcessor((stats) => this.options.onFrameProcessed?.(stats))
    // Set the mode before attaching: init applies it, so the first processed frame is already blurred.
    await processor.switchTo(options)
    if (this.destroyed) {
      await processor.destroy().catch(() => undefined)
      return
    }
    this.processor = processor
    try {
      await this.options.setCameraProcessor(processor)
    } catch (error) {
      await this.detach(processor)
      throw error
    }
    this.applied = level
  }

  private async detach(processor: BlurProcessor): Promise<void> {
    if (this.processor === processor) this.processor = null
    // The processor never ran on the track (init failed), so this only clears call-core's reference.
    await this.options.setCameraProcessor(null).catch(() => undefined)
    await processor.destroy().catch(() => undefined)
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }
}
