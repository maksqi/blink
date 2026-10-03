/**
 * Feature detection for background blur and RNNoise (pure over an injectable environment, so it is unit-tested).
 * Unsupported controls stay visible but disabled, with the reason below.
 *
 * - Blur mirrors `supportsBackgroundProcessors()` of @livekit/track-processors 0.8.1 (BackgroundTransformer.isSupported
 *   && ProcessorWrapper.isSupported): OffscreenCanvas, VideoFrame, createImageBitmap and WebGL2, plus either
 *   MediaStreamTrackProcessor/Generator (Chromium) or the canvas.captureStream() fallback (Firefox >= 130, Safari >=
 *   16.4). It is re-implemented so the call page does not load MediaPipe until blur is turned on; creating the
 *   processor runs the library's own check again.
 * - RNNoise needs AudioWorklet, WebAssembly and a 48 kHz mic AudioContext (it processes 480-sample frames at 48 kHz).
 *   Firefox may move the shared context to the device rate (app/lib/livekit/audio-context.ts).
 */

export interface MediaFxEnv {
  hasOffscreenCanvas: boolean
  hasVideoFrame: boolean
  hasCreateImageBitmap: boolean
  hasWebGL2: boolean
  /** MediaStreamTrackProcessor and MediaStreamTrackGenerator (the processor's fast path). */
  hasTrackProcessor: boolean
  /** HTMLCanvasElement.prototype.captureStream (the processor's fallback path). */
  hasCanvasCaptureStream: boolean
  /** AudioWorkletNode and AudioContext.prototype.audioWorklet (secure contexts only). */
  hasAudioWorklet: boolean
  hasWebAssembly: boolean
}

export type EffectSupport = { ok: true } | { ok: false; reason: string }

export const RNNOISE_SAMPLE_RATE = 48_000

export const BLUR_UNSUPPORTED = "Your browser can't blur the background"
export const RNNOISE_UNSUPPORTED = "Your browser can't run enhanced noise suppression"

export function rnnoiseSampleRateReason(sampleRate: number): string {
  const khz = Math.round(sampleRate / 100) / 10
  return `Enhanced noise suppression needs 48 kHz audio, but your browser records at ${khz} kHz`
}

const OK: EffectSupport = { ok: true }

export function supportsBlur(env: MediaFxEnv): EffectSupport {
  const transformer = env.hasOffscreenCanvas && env.hasVideoFrame && env.hasCreateImageBitmap && env.hasWebGL2
  const wrapper = env.hasTrackProcessor || (env.hasVideoFrame && env.hasCanvasCaptureStream)
  return transformer && wrapper ? OK : { ok: false, reason: BLUR_UNSUPPORTED }
}

/** `sampleRate` is the shared mic AudioContext's rate (null when it is not known yet). */
export function supportsRnnoise(env: MediaFxEnv, sampleRate: number | null): EffectSupport {
  if (!env.hasAudioWorklet || !env.hasWebAssembly) return { ok: false, reason: RNNOISE_UNSUPPORTED }
  if (sampleRate !== null && sampleRate !== RNNOISE_SAMPLE_RATE) {
    return { ok: false, reason: rnnoiseSampleRateReason(sampleRate) }
  }
  return OK
}

let webgl2: boolean | null = null

/** Creates one throwaway WebGL2 context (cached), like the library's check, and releases it right away. */
function probeWebGL2(): boolean {
  if (webgl2 !== null) return webgl2
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    webgl2 = Boolean(gl)
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    webgl2 = false
  }
  return webgl2
}

/** Reads the current browser. Call only in the browser. */
export function currentMediaFxEnv(): MediaFxEnv {
  const w = window as unknown as Record<string, unknown>
  const has = (name: string) => typeof w[name] !== 'undefined'
  const canvasProto = has('HTMLCanvasElement') ? (w.HTMLCanvasElement as { prototype: object }).prototype : null
  const audioProto = has('AudioContext') ? (w.AudioContext as { prototype: object }).prototype : null
  const transformer = has('OffscreenCanvas') && has('VideoFrame') && has('createImageBitmap')
  return {
    hasOffscreenCanvas: has('OffscreenCanvas'),
    hasVideoFrame: has('VideoFrame'),
    hasCreateImageBitmap: has('createImageBitmap'),
    // Only probed when the rest is there: a context is not free.
    hasWebGL2: transformer && probeWebGL2(),
    hasTrackProcessor: has('MediaStreamTrackProcessor') && has('MediaStreamTrackGenerator'),
    hasCanvasCaptureStream: canvasProto !== null && 'captureStream' in canvasProto,
    hasAudioWorklet: has('AudioWorkletNode') && audioProto !== null && 'audioWorklet' in audioProto,
    hasWebAssembly: typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function',
  }
}
