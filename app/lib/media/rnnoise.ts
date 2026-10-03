/**
 * RNNoise (@sapphi-red/web-noise-suppressor 0.4) in call-core's mic chain:
 *
 *   mic → MediaStreamAudioSource → [RNNoise worklet] → GainNode (own mic gain) → published track
 *
 * - Runs on the shared mic AudioContext (`MediaControl.audioContext()`), never a second one, and only at 48 kHz
 *   (480-sample frames). Firefox may move the shared context to the device rate; the insert then passes audio through
 *   unchanged and reports `RnnoiseUnavailableError`.
 * - The worklet module is a same-origin file (`/vendor/rnnoise/workletProcessor.js`), added once per context; the wasm
 *   (SIMD when available) is fetched once per page. The package is imported on demand: it subclasses AudioWorkletNode
 *   at module load, which throws in browsers without AudioWorklet.
 * - One RNNoise node per context is reused by every insert: call-core calls `connect()` again after each mic restart
 *   or device switch, and the library's processor ignores its "destroy" message (its port is never started), so a
 *   node per insert would keep running forever. Without input the node does no work.
 */
import type { MicInsert } from '../contracts/call'
import { RNNOISE_SAMPLE_RATE } from './support'
import { VENDOR_PATHS } from './vendor-paths'

type NoiseSuppressorModule = typeof import('@sapphi-red/web-noise-suppressor')

export type RnnoiseNode = AudioWorkletNode

export class RnnoiseUnavailableError extends Error {
  constructor(readonly sampleRate: number) {
    super(`RNNoise needs a ${RNNOISE_SAMPLE_RATE} Hz AudioContext (got ${sampleRate} Hz)`)
    this.name = 'RnnoiseUnavailableError'
  }
}

export class RnnoiseProcessorError extends Error {
  constructor() {
    super('The RNNoise processor stopped with an error')
    this.name = 'RnnoiseProcessorError'
  }
}

/** Caches a promise and forgets it when it rejects, so a later call can retry. */
function cached<T>(load: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null
  return () => {
    promise ??= load().catch((error: unknown) => {
      promise = null
      throw error
    })
    return promise
  }
}

export const loadNoiseSuppressor = cached<NoiseSuppressorModule>(() => import('@sapphi-red/web-noise-suppressor'))

export const loadRnnoiseWasm = cached<ArrayBuffer>(async () => {
  const { loadRnnoise } = await loadNoiseSuppressor()
  const binary = await loadRnnoise({ url: VENDOR_PATHS.rnnoiseWasm, simdUrl: VENDOR_PATHS.rnnoiseSimdWasm })
  // fetch() resolves for 404s too; a page instead of wasm would only fail inside the worklet.
  if (!WebAssembly.validate(binary)) throw new Error('The RNNoise wasm file is invalid')
  return binary
})

const worklets = new WeakMap<BaseAudioContext, Promise<void>>()

/** Adds the RNNoise worklet module to `context` once. */
export function ensureRnnoiseWorklet(context: BaseAudioContext): Promise<void> {
  let ready = worklets.get(context)
  if (!ready) {
    ready = context.audioWorklet.addModule(VENDOR_PATHS.rnnoiseWorklet).catch((error: unknown) => {
      worklets.delete(context)
      throw error
    })
    worklets.set(context, ready)
  }
  return ready
}

export function assertRnnoiseSampleRate(context: BaseAudioContext): void {
  if (context.sampleRate !== RNNOISE_SAMPLE_RATE) throw new RnnoiseUnavailableError(context.sampleRate)
}

/** Loads everything RNNoise needs on `context` (fails early, before the mic chain is touched). */
export async function prepareRnnoise(context: BaseAudioContext): Promise<void> {
  assertRnnoiseSampleRate(context)
  await Promise.all([loadRnnoiseWasm(), ensureRnnoiseWorklet(context)])
}

/** A new RNNoise node on `context` (mono). The measurement test hook uses its own OfflineAudioContext. */
export async function createRnnoiseNode(context: BaseAudioContext): Promise<RnnoiseNode> {
  await prepareRnnoise(context)
  const [{ RnnoiseWorkletNode }, wasmBinary] = await Promise.all([loadNoiseSuppressor(), loadRnnoiseWasm()])
  return new RnnoiseWorkletNode(context as AudioContext, { maxChannels: 1, wasmBinary })
}

const nodes = new WeakMap<BaseAudioContext, Promise<RnnoiseNode>>()

/** The one RNNoise node of the mic context (created on first use). */
export function sharedRnnoiseNode(context: BaseAudioContext): Promise<RnnoiseNode> {
  let node = nodes.get(context)
  if (!node) {
    node = createRnnoiseNode(context).catch((error: unknown) => {
      nodes.delete(context)
      throw error
    })
    nodes.set(context, node)
  }
  return node
}

/** Drops a broken node (after a processorerror) so the next insert builds a new one. */
export function forgetRnnoiseNode(context: BaseAudioContext): void {
  nodes.delete(context)
}

export interface RnnoiseInsertOptions {
  /** Called when RNNoise cannot run (wrong sample rate, load failure, processor error); audio then passes through. */
  onError: (error: unknown) => void
  /** Injectable for tests. */
  getNode?: (context: BaseAudioContext) => Promise<RnnoiseNode>
  forgetNode?: (context: BaseAudioContext) => void
}

export interface RnnoiseInsert extends MicInsert {
  /** True while the chain runs through RNNoise. */
  readonly active: boolean
}

/**
 * The `MicInsert` for call-core's chain. `connect()` never throws: it runs while the mic (re)starts, and a throw there
 * would break the microphone. On any failure it returns the input (pass-through) and reports through `onError`.
 */
export function createRnnoiseInsert(options: RnnoiseInsertOptions): RnnoiseInsert {
  const getNode = options.getNode ?? sharedRnnoiseNode
  const forgetNode = options.forgetNode ?? forgetRnnoiseNode
  let node: RnnoiseNode | null = null
  let disposed = false

  const onProcessorError = () => {
    const broken = node
    if (!broken) return
    forgetNode(broken.context)
    release()
    options.onError(new RnnoiseProcessorError())
  }

  function release() {
    if (!node) return
    node.removeEventListener('processorerror', onProcessorError)
    node.disconnect()
    node = null
  }

  return {
    id: 'rnnoise',
    get active() {
      return node !== null && !disposed
    },
    async connect(context, input) {
      if (disposed) return input
      try {
        assertRnnoiseSampleRate(context)
        if (!node || node.context !== context) {
          release()
          const next = await getNode(context)
          if (disposed) return input
          next.disconnect() // detach a previous insert's leftovers (the node is shared)
          next.addEventListener('processorerror', onProcessorError)
          node = next
        }
        input.connect(node)
        return node
      } catch (error) {
        release()
        options.onError(error)
        return input
      }
    },
    dispose() {
      disposed = true
      release()
    },
  }
}
