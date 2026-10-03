/**
 * CPU warning for background blur (pure core; the caller feeds it samples and shows the toast).
 *
 * Warns when either holds while blur is on:
 * - the rolling WINDOW_MS average of the processor's per-frame `processingTimeMs` exceeds BUDGET_RATIO of the frame
 *   budget (1000 / camera frame rate), measured only once a full window of samples exists, or
 * - the camera sender reports `qualityLimitationReason === 'cpu'` continuously for WINDOW_MS.
 * It fires at most once per call: `reset()` (blur turned off, camera restarted) restarts the windows but never re-arms.
 */

export const CPU_WINDOW_MS = 10_000
export const CPU_BUDGET_RATIO = 0.8
export const DEFAULT_FRAME_RATE = 30

export type CpuWarningCause = 'processing-time' | 'quality-limitation'

export interface CpuMonitorOptions {
  windowMs?: number
  budgetRatio?: number
}

/** Milliseconds available per frame at `frameRate` (unknown or nonsense rates count as 30 fps). */
export function frameBudgetMs(frameRate: number | null | undefined): number {
  const fps =
    typeof frameRate === 'number' && Number.isFinite(frameRate) && frameRate > 0
      ? Math.min(Math.max(frameRate, 1), 60)
      : DEFAULT_FRAME_RATE
  return 1000 / fps
}

export class CpuMonitor {
  private readonly windowMs: number
  private readonly budgetRatio: number
  private frames: Array<{ at: number; ms: number }> = []
  private firstFrameAt: number | null = null
  private cpuLimitedSince: number | null = null
  private firedCause: CpuWarningCause | null = null

  constructor(options: CpuMonitorOptions = {}) {
    this.windowMs = options.windowMs ?? CPU_WINDOW_MS
    this.budgetRatio = options.budgetRatio ?? CPU_BUDGET_RATIO
  }

  /** True once the warning fired (it never fires again in this call). */
  get warned(): boolean {
    return this.firedCause !== null
  }

  get cause(): CpuWarningCause | null {
    return this.firedCause
  }

  /** Rolling average of the last window (0 without samples). */
  averageMs(): number {
    if (this.frames.length === 0) return 0
    return this.frames.reduce((sum, frame) => sum + frame.ms, 0) / this.frames.length
  }

  /** One processed frame. Returns true when this sample triggers the warning. */
  recordFrame(now: number, processingTimeMs: number, frameRate?: number | null): boolean {
    if (this.warned || !Number.isFinite(processingTimeMs) || processingTimeMs < 0) return false
    this.firstFrameAt ??= now
    this.frames.push({ at: now, ms: processingTimeMs })
    const start = now - this.windowMs
    while (this.frames.length > 0 && this.frames[0]!.at < start) this.frames.shift()
    if (now - this.firstFrameAt < this.windowMs) return false
    if (this.averageMs() <= this.budgetRatio * frameBudgetMs(frameRate)) return false
    return this.fire('processing-time')
  }

  /** One sender-stats sample (`qualityLimitationReason` of the camera's layers). */
  recordQualityLimitation(now: number, reason: string | null | undefined): boolean {
    if (this.warned) return false
    if (reason !== 'cpu') {
      this.cpuLimitedSince = null
      return false
    }
    this.cpuLimitedSince ??= now
    if (now - this.cpuLimitedSince < this.windowMs) return false
    return this.fire('quality-limitation')
  }

  /** Blur was turned off or the camera restarted: measure from scratch (the once-per-call flag stays). */
  reset(): void {
    this.frames = []
    this.firstFrameAt = null
    this.cpuLimitedSince = null
  }

  private fire(cause: CpuWarningCause): boolean {
    this.firedCause = cause
    this.reset()
    return true
  }
}
