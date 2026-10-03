/**
 * The mic chain (audio-context.ts) sends what its AudioContext renders. A context that never runs (no audio output
 * device or backend, e.g. Firefox in a container without sound) renders nothing, so the published microphone would be
 * silence with no hint why (F-060). After the Join click resumed it, the call waits a moment for the context to run
 * and otherwise sends the raw microphone instead (no own gain, no RNNoise), telling the person. E2EE is unaffected:
 * the frame encryption sits on the sender, not on the track.
 */

/** How long the context may take to run after joining before the raw microphone is sent (decision). */
export const MIC_CHAIN_START_TIMEOUT_MS = 3_000

export type AudioContextLike = Pick<BaseAudioContext, 'state' | 'addEventListener' | 'removeEventListener'>

export interface Timers {
  set(callback: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const defaultTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** Resolves true once `context` runs, false when it is closed or still not running after `timeoutMs`. */
export function waitUntilRunning(
  context: AudioContextLike,
  timeoutMs: number = MIC_CHAIN_START_TIMEOUT_MS,
  timers: Timers = defaultTimers,
): Promise<boolean> {
  if (context.state === 'running') return Promise.resolve(true)
  if (context.state === 'closed') return Promise.resolve(false)
  return new Promise((resolve) => {
    const finish = (running: boolean) => {
      timers.clear(handle)
      context.removeEventListener('statechange', onChange)
      resolve(running)
    }
    const onChange = () => {
      if (context.state === 'running') finish(true)
      else if (context.state === 'closed') finish(false)
    }
    const handle = timers.set(() => finish(context.state === 'running'), timeoutMs)
    context.addEventListener('statechange', onChange)
  })
}
