import { EventEmitter } from 'node:events'
import { TrackEvent } from 'livekit-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalMedia, type LocalMediaStatus } from './local-media'
import { DEFAULT_MEDIA_LIMITS } from './presets'

const devices = vi.hoisted(() => ({
  video: [] as Array<() => Promise<unknown>>,
  audio: [] as Array<() => Promise<unknown>>,
}))

vi.mock('livekit-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('livekit-client')>()),
  createLocalVideoTrack: vi.fn(() => {
    const next = devices.video.shift()
    if (!next) throw new Error('no fake camera queued')
    return next()
  }),
  createLocalAudioTrack: vi.fn(() => {
    const next = devices.audio.shift()
    if (!next) throw new Error('no fake microphone queued')
    return next()
  }),
}))

// The real chain needs an AudioContext; LocalMedia only hands it to the mic track.
vi.mock('./audio-context', () => ({
  sharedAudioContext: () => ({}),
  MicChain: class {
    audioContext = {}
    onRebuilt: (() => void) | null = null
    destroy = vi.fn(async () => undefined)
    setInsert = vi.fn(async () => undefined)
    setGain = vi.fn()
  },
}))

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

/** A LiveKit local track with the parts LocalMedia uses; `gate` holds the next unmute or setProcessor. */
class FakeTrack extends EventEmitter {
  isMuted = false
  processor: unknown = undefined
  gate: Promise<void> | null = null
  readonly stop = vi.fn()
  readonly setDeviceId = vi.fn(async () => true)
  readonly mediaStreamTrack = {}

  async mute() {
    this.isMuted = true
    this.emit(TrackEvent.Muted, this)
    return this
  }

  async unmute() {
    await this.gate
    this.isMuted = false
    this.emit(TrackEvent.Unmuted, this)
    return this
  }

  async setProcessor(processor: unknown) {
    await this.gate
    this.processor = processor
  }

  getProcessor() {
    return this.processor
  }

  setAudioContext() {}

  async getDeviceId() {
    return 'device-1'
  }
}

/** Queues a camera (or mic) that opens when the returned `open()` is called. */
function pendingDevice(kind: 'video' | 'audio') {
  const track = new FakeTrack()
  const opened = deferred()
  devices[kind].push(async () => {
    await opened.promise
    return track
  })
  return { track, open: () => opened.resolve() }
}

function readyDevice(kind: 'video' | 'audio') {
  const track = new FakeTrack()
  devices[kind].push(async () => track)
  return track
}

function media() {
  const statuses: LocalMediaStatus[] = []
  const local = new LocalMedia({
    limits: DEFAULT_MEDIA_LIMITS,
    onStatus: (status) => statuses.push(status),
    onTracks: vi.fn(),
  })
  return { local, statuses }
}

beforeEach(() => {
  devices.video.length = 0
  devices.audio.length = 0
})

describe('LocalMedia after dispose (F-036)', () => {
  it('stops a camera that finishes opening after dispose', async () => {
    const { local } = media()
    const camera = pendingDevice('video')
    const enabling = local.enableCamera()
    await vi.waitFor(() => expect(devices.video).toHaveLength(0))
    local.dispose()
    camera.open()
    await enabling
    expect(camera.track.stop).toHaveBeenCalledTimes(1)
    expect(local.camera).toBeNull()
  })

  it('stops a microphone that finishes opening after dispose', async () => {
    const { local } = media()
    const mic = pendingDevice('audio')
    const enabling = local.enableMic()
    await vi.waitFor(() => expect(devices.audio).toHaveLength(0))
    local.dispose()
    mic.open()
    await enabling
    expect(mic.track.stop).toHaveBeenCalledTimes(1)
    expect(local.mic).toBeNull()
  })

  it('stops a microphone whose mic chain is still being attached at dispose', async () => {
    const { local } = media()
    const track = readyDevice('audio')
    const attach = deferred()
    track.gate = attach.promise
    const ensuring = local.ensureMic()
    await vi.waitFor(() => expect(devices.audio).toHaveLength(0))
    await Promise.resolve()
    local.dispose()
    attach.resolve()
    await ensuring
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(local.mic).toBeNull()
  })

  it('stops a camera that was turned back on while the page went away', async () => {
    const { local } = media()
    const track = readyDevice('video')
    await local.enableCamera()
    await local.disableCamera()
    const unmuted = deferred()
    track.gate = unmuted.promise
    const enabling = local.enableCamera()
    await Promise.resolve()
    local.dispose()
    expect(track.stop).toHaveBeenCalledTimes(1)
    // LiveKit reacquires the device on unmute: that capture has to be stopped as well.
    unmuted.resolve()
    await enabling
    expect(track.stop).toHaveBeenCalledTimes(2)
  })

  it('skips work queued behind a pending device and refuses new work', async () => {
    const { local } = media()
    const camera = pendingDevice('video')
    const enabling = local.enableCamera()
    const switching = local.switchCamera('device-2')
    await vi.waitFor(() => expect(devices.video).toHaveLength(0))
    local.dispose()
    camera.open()
    await Promise.all([enabling, switching])
    expect(camera.track.setDeviceId).not.toHaveBeenCalled()

    readyDevice('video')
    await local.enableCamera()
    await local.enableMic()
    expect(devices.video).toHaveLength(1)
    expect(local.camera).toBeNull()
    expect(local.mic).toBeNull()
  })
})

describe('LocalMedia status (F-005)', () => {
  it('follows a mute it did not make (a host muting the published track) and the unmute after it', async () => {
    const { local } = media()
    const camera = readyDevice('video')
    const mic = readyDevice('audio')
    await local.enableCamera()
    await local.enableMic()
    expect(local.status).toMatchObject({ cameraOn: true, micOn: true })

    // LiveKit's remote mute calls mute() on the local track.
    await camera.mute()
    await mic.mute()
    expect(local.status).toMatchObject({ cameraOn: false, micOn: false })

    // One click turns it back on.
    await local.enableCamera()
    await local.enableMic()
    expect(local.status).toMatchObject({ cameraOn: true, micOn: true })
  })

  it('ignores a track it no longer owns', async () => {
    const { local, statuses } = media()
    const camera = readyDevice('video')
    await local.enableCamera()
    local.dispose()
    const count = statuses.length
    await camera.mute()
    expect(statuses).toHaveLength(count)
  })
})

describe('LocalMedia.idle (F-059)', () => {
  it('resolves once the work queued so far has finished, also after a failure', async () => {
    const { local } = media()
    const mic = pendingDevice('audio')
    const enabling = local.enableMic()
    let idle = false
    const waiting = local.idle('mic').then(() => (idle = true))
    await vi.waitFor(() => expect(devices.audio).toHaveLength(0))
    expect(idle).toBe(false)
    mic.open()
    await enabling
    await waiting
    expect(idle).toBe(true)

    devices.video.push(async () => {
      throw new DOMException('denied', 'NotAllowedError')
    })
    await expect(local.enableCamera()).rejects.toThrow('denied')
    await expect(local.idle('camera')).resolves.toBeUndefined()
  })
})
