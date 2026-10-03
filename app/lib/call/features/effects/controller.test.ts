import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive, shallowRef } from 'vue'
import type { CallContext, CallPhase, MediaControl, MicInsert } from '../../../contracts/call'
import type { PrefsStorage } from '../../devices'
import type { BlurProcessor, BlurSwitchOptions } from '../../../media/blur'
import { MEDIA_PREFS_KEY, readMediaPrefs, type MediaPrefs } from '../../../media/preferences'
import { RnnoiseUnavailableError, type RnnoiseInsert, type RnnoiseInsertOptions } from '../../../media/rnnoise'
import type { MediaFxEnv } from '../../../media/support'
import { BLUR_FAILED, CPU_WARNING, EffectsController, RNNOISE_FAILED, type EffectsStoreView } from './controller'

const fullEnv: MediaFxEnv = {
  hasOffscreenCanvas: true,
  hasVideoFrame: true,
  hasCreateImageBitmap: true,
  hasWebGL2: true,
  hasTrackProcessor: true,
  hasCanvasCaptureStream: true,
  hasAudioWorklet: true,
  hasWebAssembly: true,
}

function memoryStorage(prefs?: Partial<MediaPrefs>): PrefsStorage & { data: Record<string, string> } {
  const data: Record<string, string> = prefs ? { [MEDIA_PREFS_KEY]: JSON.stringify(prefs) } : {}
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value
    },
  }
}

const track = (id: string) => ({ id, getSettings: () => ({ frameRate: 30 }) }) as unknown as MediaStreamTrack

/** Lets watchers, queued promise chains and microtasks settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

interface Options {
  prefs?: Partial<MediaPrefs>
  expected?: { videoinput?: string; audioinput?: string }
  sampleRate?: number
  env?: MediaFxEnv
  attachFails?: boolean
  prepareFails?: boolean
  phase?: CallPhase
}

function harness(options: Options = {}) {
  const calls: string[] = []
  const store = reactive({
    media: {
      cameraOn: false,
      cameraBusy: false,
      cameraError: null as string | null,
      cameraDeviceId: null as string | null,
      micDeviceId: null as string | null,
    },
    micGain: 1,
  })
  const phase = shallowRef<CallPhase>(options.phase ?? 'prejoin')
  const audioContext = { sampleRate: options.sampleRate ?? 48_000 }
  const raw = track('raw-camera')
  let attached: (BlurProcessor & { processedTrack?: MediaStreamTrack }) | null = null
  let time = 0

  /** Like call-core: the processor initializes on a running camera and its output becomes the camera track. */
  const cameraTrack = () => {
    if (!store.media.cameraOn) return null
    return attached?.processedTrack ?? raw
  }
  const initProcessor = async () => {
    if (!attached || !store.media.cameraOn) return
    if (options.attachFails) throw new Error('init failed')
    attached.processedTrack ??= track('processed-camera')
  }
  const media: MediaControl = {
    cameraTrack,
    micTrack: () => null,
    audioContext: () => audioContext as AudioContext,
    setCameraProcessor: vi.fn(async (processor) => {
      calls.push(processor ? 'camera:attach' : 'camera:detach')
      attached = processor as typeof attached
      await initProcessor()
    }),
    setMicInsert: vi.fn(async (insert: MicInsert | null) => {
      calls.push(insert ? `insert:${insert.id}` : 'insert:none')
    }),
    setMicProcessing: vi.fn(async (constraints) => {
      calls.push(`processing:${constraints.noiseSuppression ? 'ns' : 'no-ns'}`)
    }),
  }
  const audio = {
    setLocalVolume: vi.fn(),
    getLocalVolume: vi.fn(() => 1),
    setMicGain: vi.fn((gain: number) => {
      store.micGain = gain
    }),
    remoteAudioTracks: vi.fn(() => []),
  }
  const ctx = { media, audio, phase, room: shallowRef(null) } as unknown as CallContext

  const processors: Array<{
    switches: BlurSwitchOptions[]
    destroy: ReturnType<typeof vi.fn>
    frame: (ms: number) => void
  }> = []
  const createBlurProcessor = vi.fn(async (onFrame: (stats: { processingTimeMs: number }) => void) => {
    const switches: BlurSwitchOptions[] = []
    const destroy = vi.fn(async () => undefined)
    const processor = {
      name: 'fake-background',
      processedTrack: undefined as MediaStreamTrack | undefined,
      init: vi.fn(),
      restart: vi.fn(),
      destroy,
      switchTo: vi.fn(async (o: BlurSwitchOptions) => {
        switches.push(o)
      }),
    }
    processors.push({ switches, destroy, frame: (ms) => onFrame({ processingTimeMs: ms }) })
    return processor as unknown as BlurProcessor
  })

  const inserts: Array<RnnoiseInsertOptions> = []
  const rnnoise = {
    prepare: vi.fn(async () => {
      if (options.prepareFails) throw new Error('worklet blocked')
    }),
    createInsert: vi.fn((insertOptions: RnnoiseInsertOptions) => {
      inserts.push(insertOptions)
      return {
        id: 'rnnoise',
        active: true,
        connect: async (_context: AudioContext, input: AudioNode) => input,
        dispose: vi.fn(),
      } as unknown as RnnoiseInsert
    }),
  }
  const notify = { error: vi.fn(), cpuWarning: vi.fn() }
  const storage = memoryStorage(options.prefs)
  const controller = new EffectsController({
    ctx,
    store: store as EffectsStoreView,
    env: options.env ?? fullEnv,
    storage,
    expectedDevices: options.expected,
    createBlurProcessor,
    rnnoise,
    notify,
    now: () => time,
  })
  return {
    controller,
    state: controller.state,
    store,
    phase,
    media,
    audio,
    calls,
    processors,
    inserts,
    rnnoise,
    notify,
    storage,
    saved: () => readMediaPrefs(storage),
    advance: (ms: number) => {
      time += ms
    },
    /** Like call-core's enableCamera: a processor stored while the camera was off initializes now. */
    startCamera: async (deviceId = 'cam-1') => {
      store.media = { ...store.media, cameraOn: true, cameraDeviceId: deviceId }
      await initProcessor()
      await settle()
    },
    /** Firefox moving the shared context to the device rate. */
    setSampleRate: (rate: number) => {
      audioContext.sampleRate = rate
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('__BLINQ_TEST_HOOKS__', false)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('EffectsController: start', () => {
  it('applies the remembered choices of the expected devices before the tracks start', async () => {
    const h = harness({
      prefs: {
        cameras: [{ id: 'cam-1', blur: 'strong' }],
        mics: [{ id: 'mic-1', noise: 'rnnoise', gain: 1.5 }],
      },
      expected: { videoinput: 'cam-1', audioinput: 'mic-1' },
    })
    h.controller.start()
    await settle()
    expect(h.audio.setMicGain).toHaveBeenCalledWith(1.5)
    expect(h.state).toMatchObject({ blur: 'strong', noise: 'rnnoise', gain: 1.5 })
    // Constraints first, then the insert.
    expect(h.calls).toEqual(['processing:no-ns', 'insert:rnnoise'])
    // Pre-join: blur waits for the camera to run, so a load failure never breaks the camera start.
    expect(h.processors).toHaveLength(0)

    await h.startCamera('cam-1')
    expect(h.calls).toContain('camera:attach')
    expect(h.processors[0]!.switches).toEqual([{ mode: 'background-blur', blurRadius: 14 }])
    expect(h.state.blurActive).toBe(true)
    expect(h.state.blurLoading).toBe(false)
  })

  it('starts with the defaults (blur off, browser suppression, gain 1) and touches nothing', async () => {
    const h = harness()
    h.controller.start()
    await h.startCamera()
    expect(h.state).toMatchObject({ blur: 'off', noise: 'browser', gain: 1 })
    expect(h.calls).toEqual([])
    expect(h.audio.setMicGain).not.toHaveBeenCalled()
  })

  it('falls back to supported choices without overwriting the saved ones', async () => {
    const prefs = { defaults: { blur: 'light', noise: 'rnnoise', gain: 1, lastBlur: 'light' } } as const
    const h = harness({ prefs, env: { ...fullEnv, hasVideoFrame: false }, sampleRate: 44_100 })
    h.controller.start()
    await h.startCamera()
    expect(h.state.blurSupport).toEqual({ ok: false, reason: "Your browser can't blur the background" })
    expect(h.state.rnnoiseSupport.ok).toBe(false)
    expect(h.state).toMatchObject({ blur: 'off', noise: 'browser' })
    expect(h.processors).toHaveLength(0)
    expect(h.rnnoise.prepare).not.toHaveBeenCalled()
    expect(h.saved().defaults).toMatchObject({ blur: 'light', noise: 'rnnoise' })
    // The disabled controls cannot pick them either.
    await h.controller.setBlur('strong')
    await h.controller.setNoise('rnnoise')
    expect(h.state).toMatchObject({ blur: 'off', noise: 'browser' })
  })
})

describe('EffectsController: noise suppression', () => {
  it('switches constraints first, then the insert, and never republishes', async () => {
    const h = harness()
    h.controller.start()
    await settle()
    await h.controller.setNoise('rnnoise')
    expect(h.calls).toEqual(['processing:no-ns', 'insert:rnnoise'])
    await h.controller.setNoise('off')
    // Same constraints as RNNoise: only the insert goes.
    expect(h.calls.slice(2)).toEqual(['insert:none'])
    await h.controller.setNoise('browser')
    expect(h.calls.slice(3)).toEqual(['processing:ns'])
    await h.controller.setNoise('rnnoise')
    expect(h.calls.slice(4)).toEqual(['processing:no-ns', 'insert:rnnoise'])
    expect(h.rnnoise.createInsert).toHaveBeenCalledTimes(2)
  })

  it('falls back to browser suppression with a toast when RNNoise cannot load (not remembered)', async () => {
    const h = harness({ prepareFails: true })
    h.controller.start()
    await settle()
    await h.controller.setNoise('rnnoise')
    await settle()
    expect(h.state.noise).toBe('browser')
    expect(h.notify.error).toHaveBeenCalledWith(RNNOISE_FAILED)
    expect(h.media.setMicInsert).not.toHaveBeenCalled()
    expect(h.calls).toEqual(['processing:no-ns', 'processing:ns'])
    // The user's choice stays saved and is tried again next time.
    expect(h.saved().defaults.noise).toBe('rnnoise')
  })

  it('disables RNNoise with the reason when the mic context leaves 48 kHz', async () => {
    const h = harness()
    h.controller.start()
    await settle()
    await h.controller.setNoise('rnnoise')
    h.setSampleRate(44_100)
    h.inserts[0]!.onError(new RnnoiseUnavailableError(44_100))
    await settle()
    expect(h.state.noise).toBe('browser')
    expect(h.state.rnnoiseSupport).toEqual({
      ok: false,
      reason: 'Enhanced noise suppression needs 48 kHz audio, but your browser records at 44.1 kHz',
    })
    expect(h.notify.error).toHaveBeenCalledWith(
      'Enhanced noise suppression needs 48 kHz audio, but your browser records at 44.1 kHz. Using browser noise suppression.',
    )
    expect(h.calls).toContain('insert:none')
    expect(h.calls.at(-1)).toBe('processing:ns')
  })
})

describe('EffectsController: blur', () => {
  it('attaches once and afterwards only switches modes', async () => {
    const h = harness()
    h.controller.start()
    await h.startCamera()
    await h.controller.setBlur('light')
    await h.controller.setBlur('off')
    await h.controller.setBlur('strong')
    await h.controller.toggleBlur()
    await h.controller.toggleBlur()
    expect(h.calls.filter((call) => call.startsWith('camera:'))).toEqual(['camera:attach'])
    expect(h.processors).toHaveLength(1)
    expect(h.processors[0]!.switches).toEqual([
      { mode: 'background-blur', blurRadius: 6 },
      { mode: 'disabled' },
      { mode: 'background-blur', blurRadius: 14 },
      { mode: 'disabled' },
      // The toggle restores the last level chosen.
      { mode: 'background-blur', blurRadius: 14 },
    ])
  })

  it('shows a toast and returns to off when blur cannot start; the camera stays unprocessed', async () => {
    const h = harness({ attachFails: true })
    h.controller.start()
    await h.startCamera()
    await h.controller.setBlur('strong')
    expect(h.state.blur).toBe('off')
    expect(h.state.blurLoading).toBe(false)
    expect(h.notify.error).toHaveBeenCalledWith(BLUR_FAILED)
    expect(h.calls).toEqual(['camera:attach', 'camera:detach'])
    expect(h.processors[0]!.destroy).toHaveBeenCalled()
  })

  it('attaches right away in a call even while the camera is off', async () => {
    const h = harness({ phase: 'inCall' })
    h.controller.start()
    await settle()
    await h.controller.setBlur('light')
    expect(h.calls).toEqual(['camera:attach'])
    expect(h.state.blurActive).toBe(false)
    await h.startCamera()
    expect(h.state.blurActive).toBe(true)
  })

  it('attaches a pre-join choice when the call starts with the camera off', async () => {
    const h = harness({ prefs: { defaults: { blur: 'light', noise: 'browser', gain: 1, lastBlur: 'light' } } })
    h.controller.start()
    await settle()
    expect(h.calls).toEqual([])
    h.phase.value = 'connecting'
    await settle()
    expect(h.calls).toEqual(['camera:attach'])
  })

  it('blames a processor that never ran when the camera then fails to start', async () => {
    const h = harness({ phase: 'inCall' })
    h.controller.start()
    await settle()
    await h.controller.setBlur('strong')
    h.store.media = { ...h.store.media, cameraError: 'failed' }
    await settle()
    expect(h.state.blur).toBe('off')
    expect(h.notify.error).toHaveBeenCalledWith(BLUR_FAILED)
    expect(h.calls).toEqual(['camera:attach', 'camera:detach'])
  })

  it('destroys the processor when the call ends', async () => {
    const h = harness()
    h.controller.start()
    await h.startCamera()
    await h.controller.setBlur('light')
    h.phase.value = 'left'
    await settle()
    expect(h.processors[0]!.destroy).toHaveBeenCalled()
  })
})

describe('EffectsController: preferences', () => {
  it('remembers choices per device and re-applies them after a device switch', async () => {
    const h = harness()
    h.controller.start()
    await h.startCamera('cam-1')
    h.store.media = { ...h.store.media, micDeviceId: 'mic-1' }
    await settle()

    await h.controller.setBlur('strong')
    await h.controller.setNoise('off')
    h.controller.setGain(0.5) // through AudioControl; the store watcher remembers it
    await settle()
    expect(h.saved().cameras).toEqual([{ id: 'cam-1', blur: 'strong' }])
    expect(h.saved().mics).toEqual([{ id: 'mic-1', noise: 'off', gain: 0.5 }])

    // A new microphone starts from the latest choice; it gets its own values.
    h.store.media = { ...h.store.media, micDeviceId: 'mic-2' }
    await settle()
    expect(h.state).toMatchObject({ noise: 'off', gain: 0.5 })
    await h.controller.setNoise('browser')
    h.controller.setGain(1.25)
    await settle()

    // Back to the first one: its values return.
    h.store.media = { ...h.store.media, micDeviceId: 'mic-1' }
    await settle()
    expect(h.state).toMatchObject({ noise: 'off', gain: 0.5 })
    h.store.media = { ...h.store.media, micDeviceId: 'mic-2' }
    await settle()
    expect(h.state).toMatchObject({ noise: 'browser', gain: 1.25 })

    // Cameras: a new camera keeps the latest level, then each camera keeps its own.
    h.store.media = { ...h.store.media, cameraDeviceId: 'cam-2' }
    await settle()
    expect(h.state.blur).toBe('strong')
    await h.controller.setBlur('off')
    h.store.media = { ...h.store.media, cameraDeviceId: 'cam-1' }
    await settle()
    expect(h.state.blur).toBe('strong')
    h.store.media = { ...h.store.media, cameraDeviceId: 'cam-2' }
    await settle()
    expect(h.state.blur).toBe('off')
    expect(h.processors).toHaveLength(1)
  })

  it("remembers core's gain slider too (any change of the store's micGain)", async () => {
    const h = harness()
    h.controller.start()
    h.store.media = { ...h.store.media, micDeviceId: 'mic-1' }
    await settle()
    h.store.micGain = 1.75
    await settle()
    expect(h.state.gain).toBe(1.75)
    expect(h.saved().mics).toEqual([{ id: 'mic-1', noise: 'browser', gain: 1.75 }])
  })
})

describe('EffectsController: CPU warning', () => {
  it('warns once when blur frames take too long, and "Turn off" turns blur off', async () => {
    const h = harness()
    h.controller.start()
    await h.startCamera()
    await h.controller.setBlur('strong')
    const frame = h.processors[0]!.frame
    for (let i = 0; i < 400; i++) {
      h.advance(33)
      frame(40)
    }
    expect(h.notify.cpuWarning).toHaveBeenCalledTimes(1)
    expect(h.notify.cpuWarning).toHaveBeenCalledWith(CPU_WARNING, expect.any(Function))
    expect(h.state.blurFrames).toBe(400)
    const turnOff = h.notify.cpuWarning.mock.calls[0]![1] as () => void
    turnOff()
    await settle()
    expect(h.state.blur).toBe('off')
    expect(h.processors[0]!.switches.at(-1)).toEqual({ mode: 'disabled' })
  })

  it('stays quiet for fast frames', async () => {
    const h = harness()
    h.controller.start()
    await h.startCamera()
    await h.controller.setBlur('light')
    for (let i = 0; i < 600; i++) {
      h.advance(33)
      h.processors[0]!.frame(8)
    }
    expect(h.notify.cpuWarning).not.toHaveBeenCalled()
  })
})

describe('EffectsController: dispose', () => {
  it('stops following devices and ignores later actions', async () => {
    const h = harness()
    h.controller.start()
    await h.startCamera()
    await h.controller.setBlur('light')
    h.controller.dispose()
    await settle()
    expect(h.processors[0]!.destroy).toHaveBeenCalled()
    h.store.micGain = 2
    await settle()
    await h.controller.setNoise('off')
    expect(h.saved().defaults.gain).toBe(1)
    expect(h.calls.filter((call) => call.startsWith('processing'))).toEqual([])
  })
})
