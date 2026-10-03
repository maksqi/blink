import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BLUR_UNSUPPORTED,
  currentMediaFxEnv,
  RNNOISE_UNSUPPORTED,
  supportsBlur,
  supportsRnnoise,
  type MediaFxEnv,
} from './support'

const full: MediaFxEnv = {
  hasOffscreenCanvas: true,
  hasVideoFrame: true,
  hasCreateImageBitmap: true,
  hasWebGL2: true,
  hasTrackProcessor: true,
  hasCanvasCaptureStream: true,
  hasAudioWorklet: true,
  hasWebAssembly: true,
}

// The engines blinq targets, as their APIs look today.
const chrome = full
const firefox: MediaFxEnv = { ...full, hasTrackProcessor: false }
const safari: MediaFxEnv = { ...full, hasTrackProcessor: false }
const oldFirefox: MediaFxEnv = { ...firefox, hasVideoFrame: false } // < 130
const oldSafari: MediaFxEnv = { ...safari, hasOffscreenCanvas: false } // < 16.4

describe('supportsBlur', () => {
  it('accepts Chromium (stream processor) and Firefox/Safari (canvas fallback)', () => {
    expect(supportsBlur(chrome)).toEqual({ ok: true })
    expect(supportsBlur(firefox)).toEqual({ ok: true })
    expect(supportsBlur(safari)).toEqual({ ok: true })
  })

  it('rejects browsers without VideoFrame, OffscreenCanvas, createImageBitmap or WebGL2', () => {
    expect(supportsBlur(oldFirefox)).toEqual({ ok: false, reason: BLUR_UNSUPPORTED })
    expect(supportsBlur(oldSafari)).toEqual({ ok: false, reason: BLUR_UNSUPPORTED })
    expect(supportsBlur({ ...full, hasCreateImageBitmap: false }).ok).toBe(false)
    expect(supportsBlur({ ...full, hasWebGL2: false }).ok).toBe(false)
  })

  it('needs either the stream processor or canvas.captureStream', () => {
    expect(supportsBlur({ ...full, hasTrackProcessor: false, hasCanvasCaptureStream: true }).ok).toBe(true)
    expect(supportsBlur({ ...full, hasTrackProcessor: true, hasCanvasCaptureStream: false }).ok).toBe(true)
    expect(supportsBlur({ ...full, hasTrackProcessor: false, hasCanvasCaptureStream: false }).ok).toBe(false)
  })
})

describe('supportsRnnoise', () => {
  it('needs AudioWorklet and WebAssembly', () => {
    expect(supportsRnnoise(full, 48_000)).toEqual({ ok: true })
    expect(supportsRnnoise({ ...full, hasAudioWorklet: false }, 48_000)).toEqual({
      ok: false,
      reason: RNNOISE_UNSUPPORTED,
    })
    expect(supportsRnnoise({ ...full, hasWebAssembly: false }, 48_000).ok).toBe(false)
  })

  it('needs a 48 kHz context and explains other rates', () => {
    expect(supportsRnnoise(full, 44_100)).toEqual({
      ok: false,
      reason: 'Enhanced noise suppression needs 48 kHz audio, but your browser records at 44.1 kHz',
    })
    expect(supportsRnnoise(full, 16_000)).toMatchObject({ ok: false, reason: expect.stringContaining('16 kHz') })
  })

  it('accepts an unknown rate until the context exists', () => {
    expect(supportsRnnoise(full, null)).toEqual({ ok: true })
    expect(supportsRnnoise({ ...full, hasAudioWorklet: false }, null).ok).toBe(false)
  })
})

describe('currentMediaFxEnv', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads the globals and never probes WebGL when the rest is missing', () => {
    const createElement = vi.fn()
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('document', { createElement })
    vi.stubGlobal('OffscreenCanvas', undefined)
    vi.stubGlobal('VideoFrame', undefined)
    vi.stubGlobal('AudioWorkletNode', undefined)
    const env = currentMediaFxEnv()
    expect(env.hasOffscreenCanvas).toBe(false)
    expect(env.hasVideoFrame).toBe(false)
    expect(env.hasWebGL2).toBe(false)
    expect(env.hasAudioWorklet).toBe(false)
    expect(env.hasWebAssembly).toBe(true)
    expect(createElement).not.toHaveBeenCalled()
  })

  it('can leave the WebGL2 probe for later', () => {
    const createElement = vi.fn()
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('document', { createElement })
    vi.stubGlobal('OffscreenCanvas', function Stub() {})
    vi.stubGlobal('VideoFrame', function Stub() {})
    vi.stubGlobal('createImageBitmap', () => undefined)
    expect(currentMediaFxEnv({ probeWebGL: false }).hasWebGL2).toBe(true)
    expect(createElement).not.toHaveBeenCalled()
  })

  it('detects a full browser and probes WebGL2 once', () => {
    const loseContext = vi.fn()
    const getContext = vi.fn(() => ({ getExtension: () => ({ loseContext }) }))
    const createElement = vi.fn(() => ({ getContext }))
    // Constructors only need to exist; the checks read `typeof` and prototypes.
    const ctor = () => function Stub() {}
    const Canvas = ctor()
    Object.defineProperty(Canvas.prototype, 'captureStream', { value: () => undefined })
    const Context = ctor()
    Object.defineProperty(Context.prototype, 'audioWorklet', { value: {} })
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('document', { createElement })
    vi.stubGlobal('OffscreenCanvas', ctor())
    vi.stubGlobal('VideoFrame', ctor())
    vi.stubGlobal('createImageBitmap', () => undefined)
    vi.stubGlobal('MediaStreamTrackProcessor', ctor())
    vi.stubGlobal('MediaStreamTrackGenerator', ctor())
    vi.stubGlobal('HTMLCanvasElement', Canvas)
    vi.stubGlobal('AudioContext', Context)
    vi.stubGlobal('AudioWorkletNode', ctor())
    expect(currentMediaFxEnv()).toEqual(full)
    expect(supportsBlur(currentMediaFxEnv()).ok).toBe(true)
    expect(createElement).toHaveBeenCalledTimes(1)
    expect(loseContext).toHaveBeenCalledTimes(1)
  })
})
