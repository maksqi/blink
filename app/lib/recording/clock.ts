/**
 * The compositor's frame clock: ticks at `fps` from a dedicated worker (clock.worker.ts), which keeps running in
 * background tabs. Falls back to a main-thread interval only where workers are unavailable.
 */
import ClockWorker from './clock.worker?worker'

export interface FrameClock {
  start(onTick: () => void): void
  stop(): void
}

export const RECORDING_FPS = 30

export function createFrameClock(fps: number = RECORDING_FPS): FrameClock {
  const intervalMs = 1000 / fps
  let worker: Worker | null = null
  let fallback: ReturnType<typeof setInterval> | null = null

  return {
    start(onTick) {
      this.stop()
      try {
        worker = new ClockWorker()
        worker.onmessage = () => onTick()
        worker.postMessage({ type: 'start', intervalMs })
      } catch {
        worker = null
        fallback = setInterval(onTick, intervalMs)
      }
    },
    stop() {
      if (worker) {
        worker.postMessage({ type: 'stop' })
        worker.terminate()
        worker = null
      }
      if (fallback !== null) clearInterval(fallback)
      fallback = null
    },
  }
}
