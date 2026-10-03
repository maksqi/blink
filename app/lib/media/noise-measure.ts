/**
 * Offline RNNoise measurement for the `measureNoiseSuppression()` test hook (test and dev builds only; the feature
 * imports this module behind `__BLINQ_TEST_HOOKS__`). It renders 5 s of seeded white noise at -30 dBFS RMS through
 * the real RNNoise worklet in an `OfflineAudioContext(1, 240000, 48000)` and reports the RMS of input and output over
 * 1.0-5.0 s (the first second is warm-up) plus the output's absolute peak (NaN when any sample is not finite).
 */
import { createRnnoiseNode } from './rnnoise'

export const MEASURE_SAMPLE_RATE = 48_000
export const MEASURE_LENGTH = 240_000
export const MEASURE_NOISE_DB = -30
export const MEASURE_SEED = 0x5eed_b11e
export const MEASURE_FROM = MEASURE_SAMPLE_RATE // 1.0 s

export interface NoiseMeasurement {
  inputDb: number
  outputDb: number
  peak: number
}

/** Deterministic PRNG (mulberry32), uniform in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** RMS of `samples[from, to)` in dBFS (-Infinity for silence). */
export function rmsDb(samples: ArrayLike<number>, from = 0, to = samples.length): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += samples[i]! * samples[i]!
  const rms = Math.sqrt(sum / Math.max(1, to - from))
  return rms > 0 ? 20 * Math.log10(rms) : Number.NEGATIVE_INFINITY
}

/** Largest absolute sample, or NaN when any sample is NaN or infinite. */
export function peakOf(samples: ArrayLike<number>): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i]!
    if (!Number.isFinite(value)) return Number.NaN
    peak = Math.max(peak, Math.abs(value))
  }
  return peak
}

/** Seeded uniform white noise scaled to exactly `db` dBFS RMS. */
export function whiteNoise(length: number, db: number, seed: number): Float32Array<ArrayBuffer> {
  const random = mulberry32(seed)
  const samples = new Float32Array(length)
  for (let i = 0; i < length; i++) samples[i] = random() * 2 - 1
  const scale = 10 ** (db / 20) / 10 ** (rmsDb(samples) / 20)
  for (let i = 0; i < length; i++) samples[i]! *= scale
  return samples
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * The worklet's processor instantiates its wasm asynchronously after construction and outputs silence until then.
 * Offline rendering outruns that (Firefox has no OfflineAudioContext.suspend(), and suspending mid-render shifts
 * Chromium's worklet buffering), so the render starts only after the processor had time to load. Waiting is the only
 * signal: the library's processor reports nothing. A render whose measured part contains silent stretches is retried
 * with a longer wait.
 */
const READY_WAITS_MS = [500, 2_000] as const
const SEGMENT = MEASURE_SAMPLE_RATE / 2

function hasSilentSegment(samples: Float32Array): boolean {
  for (let start = MEASURE_FROM; start < samples.length; start += SEGMENT) {
    if (rmsDb(samples, start, Math.min(samples.length, start + SEGMENT)) === Number.NEGATIVE_INFINITY) return true
  }
  return false
}

async function renderOnce(input: Float32Array<ArrayBuffer>, readyWaitMs: number): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, MEASURE_LENGTH, MEASURE_SAMPLE_RATE)
  const buffer = context.createBuffer(1, MEASURE_LENGTH, MEASURE_SAMPLE_RATE)
  buffer.copyToChannel(input, 0)
  const source = context.createBufferSource()
  source.buffer = buffer

  const node = await createRnnoiseNode(context)
  let failed = false
  node.addEventListener('processorerror', () => {
    failed = true
  })
  source.connect(node).connect(context.destination)
  source.start()
  await sleep(readyWaitMs)
  const rendered = await context.startRendering()
  if (failed) throw new Error('The RNNoise processor reported an error')
  return rendered.getChannelData(0)
}

export async function measureNoiseSuppression(): Promise<NoiseMeasurement> {
  const input = whiteNoise(MEASURE_LENGTH, MEASURE_NOISE_DB, MEASURE_SEED)
  let output: Float32Array = new Float32Array(MEASURE_LENGTH)
  for (const wait of READY_WAITS_MS) {
    output = await renderOnce(input, wait)
    if (!hasSilentSegment(output)) break
  }
  return {
    inputDb: rmsDb(input, MEASURE_FROM, MEASURE_LENGTH),
    outputDb: rmsDb(output, MEASURE_FROM, MEASURE_LENGTH),
    peak: peakOf(output),
  }
}
