import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, shallowRef } from 'vue'
import type { RoomMetadata } from '#shared/schemas/livekit'
import type { CallContext, CallPhase } from '../contracts/call'
import {
  INDICATOR_TIMEOUT_MS,
  MESSAGES,
  RecordingController,
  setForcedRecordingMime,
  type ControllerDeps,
} from './controller'
import type { CapturePipeline, CapturePipelineOptions } from './pipeline'
import type { UploadResponse, UploadTransport } from './uploader'

beforeAll(() => {
  vi.stubGlobal('__BLINQ_TEST_HOOKS__', false)
})

type Recording = NonNullable<RoomMetadata['recording']>

/** Records the order of everything that happens, across the pipeline, the API and the uploader. */
const log: string[] = []

class FakePipeline implements CapturePipeline {
  started = false
  stopped = false
  disposed = false
  frameCount = 0
  constructor(readonly options: CapturePipelineOptions) {
    log.push('pipeline:create')
  }
  startRecorder() {
    this.started = true
    log.push('recorder:start')
  }
  async stopRecorder() {
    this.stopped = true
    log.push('recorder:stop')
    // Like MediaRecorder: the final chunk arrives before stop resolves.
    this.options.onChunk(new Blob(['tail']))
  }
  dispose() {
    this.disposed = true
    log.push('pipeline:dispose')
  }
  chunk(text = 'data') {
    this.options.onChunk(new Blob([text]))
  }
  tick() {
    this.options.onTick()
  }
}

class FakeTransport implements UploadTransport {
  readonly puts: number[] = []
  completes: Array<{ chunkCount: number; durationMs: number }> = []
  putResponse: UploadResponse = { status: 204 }
  async putChunk(seq: number) {
    this.puts.push(seq)
    log.push(`put:${seq}`)
    return this.putResponse
  }
  async complete(body: { chunkCount: number; durationMs: number }) {
    this.completes.push(body)
    log.push('complete')
    return { status: 202 }
  }
}

function setup(options: { phase?: CallPhase; startError?: unknown; maxDurationMs?: number } = {}) {
  log.length = 0
  const phase = shallowRef<CallPhase>(options.phase ?? 'inCall')
  const roomState = shallowRef<RoomMetadata | null>({
    v: 1,
    epoch: 'AAAAAAAAAAAAAAAAAAAAAA',
    locked: false,
    waitingRoom: false,
    screenSharePolicy: 'everyone',
    allowSelfUnmute: true,
    chatEnabled: true,
    recording: null,
  })
  const calls: Array<{ path: string; body: unknown }> = []
  let releaseStart: (() => void) | null = null
  const callApi = vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
    calls.push({ path, body: init?.body })
    log.push(`api:${path}`)
    if (path === '/recording/start') {
      if (options.startError) throw options.startError
      await new Promise<void>((resolve) => (releaseStart = resolve))
      return { recordingId: 'rec-1', maxDurationMs: options.maxDurationMs ?? 4 * 3600_000, chunkMaxBytes: 16 << 20 }
    }
    return undefined
  })
  const ctx = {
    phase,
    roomState: computed(() => roomState.value),
    slug: shallowRef('abc-defg-hjk'),
    callApi,
  } as unknown as CallContext

  let now = Date.parse('2026-10-03T12:00:00Z')
  const pipelines: FakePipeline[] = []
  const transport = new FakeTransport()
  const saved: Array<{ parts: readonly Blob[]; mime: string; name: string }> = []
  const notify = { info: vi.fn(), success: vi.fn(), error: vi.fn() }
  const deps: ControllerDeps = {
    createClock: () => ({ start: () => undefined, stop: () => undefined }),
    notify,
    isTypeSupported: (mime) => mime.startsWith('video/webm'),
    now: () => now,
    createPipeline: (pipelineOptions) => {
      const pipeline = new FakePipeline(pipelineOptions)
      pipelines.push(pipeline)
      return pipeline
    },
    transport: () => transport,
    saveFile: (parts, mime, name) => saved.push({ parts, mime, name }),
  }
  const controller = new RecordingController(ctx, deps)
  controller.config.value = { enabled: true, maxDurationMinutes: 240, maxResolution: '1080p' }

  const setRecording = (recording: Recording | null) => {
    roomState.value = { ...roomState.value!, recording }
    controller.onIndicator(recording)
  }

  return {
    controller,
    phase,
    calls,
    callApi,
    pipelines,
    transport,
    saved,
    notify,
    setRecording,
    advance: (ms: number) => (now += ms),
    /** Resolves the pending start request (the server's 201). */
    async acknowledge() {
      await vi.waitFor(() => expect(releaseStart).not.toBeNull())
      releaseStart!()
      await flush()
    },
  }
}

async function flush() {
  for (let index = 0; index < 10; index++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const indicator = (startedAt = '2026-10-03T12:00:00.000Z'): Recording => ({ mode: 'server', by: 'Hana', startedAt })

beforeEach(() => setForcedRecordingMime(null))
afterEach(() => setForcedRecordingMime(null))

describe('RecordingController start', () => {
  it('builds the pipeline before the request and starts MediaRecorder only after the 201', async () => {
    const t = setup()
    const started = t.controller.start('server')
    expect(log).toEqual(['pipeline:create', 'api:/recording/start'])
    expect(t.pipelines[0]!.started).toBe(false)
    expect(t.controller.state.value.phase).toBe('starting')
    expect(t.calls[0]!.body).toEqual({
      mode: 'server',
      mimeType: 'video/webm;codecs=vp9,opus',
      width: 1920,
      height: 1080,
    })

    await t.acknowledge()
    expect(await started).toBe(true)
    expect(log).toEqual(['pipeline:create', 'api:/recording/start', 'recorder:start'])
    expect(t.controller.state.value).toMatchObject({ phase: 'recording', recordingId: 'rec-1', mode: 'server' })
  })

  it('sizes the canvas from the admin resolution', async () => {
    const t = setup()
    t.controller.config.value = { enabled: true, maxDurationMinutes: 240, maxResolution: '720p' }
    void t.controller.start('local')
    expect(t.calls[0]!.body).toMatchObject({ mode: 'local', width: 1280, height: 720 })
    expect(t.pipelines[0]!.options.resolution).toBe('720p')
  })

  it('honors the forced MIME family and refuses when nothing fits', async () => {
    const t = setup()
    setForcedRecordingMime('video/mp4')
    expect(await t.controller.start('server')).toBe(false)
    expect(t.callApi).not.toHaveBeenCalled()
    expect(t.pipelines).toHaveLength(0)
    expect(t.notify.error).toHaveBeenCalledWith(MESSAGES.unsupported)
    expect(t.controller.state.value).toMatchObject({ phase: 'idle', error: MESSAGES.unsupported })

    setForcedRecordingMime('video/webm;codecs=vp8')
    void t.controller.start('server')
    expect(t.calls[0]!.body).toMatchObject({ mimeType: 'video/webm;codecs=vp8,opus' })
  })

  it('disposes the pipeline and shows the server message when the start is refused', async () => {
    const error = Object.assign(new Error('This meeting is already being recorded.'), { name: 'ApiError' })
    const t = setup({ startError: error })
    expect(await t.controller.start('server')).toBe(false)
    expect(t.pipelines[0]!.started).toBe(false)
    expect(t.pipelines[0]!.disposed).toBe(true)
    expect(t.notify.error).toHaveBeenCalledWith('This meeting is already being recorded.')
    expect(t.controller.state.value.phase).toBe('idle')
  })

  it('does nothing outside the call, when disabled, or while busy', async () => {
    expect(await setup({ phase: 'prejoin' }).controller.start('server')).toBe(false)
    const disabled = setup()
    disabled.controller.config.value = { enabled: false, maxDurationMinutes: 240, maxResolution: '1080p' }
    expect(await disabled.controller.start('server')).toBe(false)
    expect(disabled.callApi).not.toHaveBeenCalled()
    const busy = setup()
    void busy.controller.start('server')
    expect(await busy.controller.start('server')).toBe(false)
    expect(busy.pipelines).toHaveLength(1)
  })

  it('never starts capturing when the call ended while the start request ran', async () => {
    const t = setup()
    const started = t.controller.start('server')
    t.phase.value = 'left'
    t.controller.onPhase('left')
    await t.acknowledge()
    expect(await started).toBe(false)
    expect(t.pipelines[0]!.started).toBe(false)
    expect(t.pipelines[0]!.disposed).toBe(true)
    expect(t.calls.map((call) => call.path)).toEqual(['/recording/start'])
  })
})

describe('RecordingController stop', () => {
  async function recording(mode: 'server' | 'local' = 'server', options: Parameters<typeof setup>[0] = {}) {
    const t = setup(options)
    const started = t.controller.start(mode)
    await t.acknowledge()
    await started
    t.setRecording(indicator())
    log.length = 0
    return t
  }

  it('stops capturing first, then turns the indicator off, then uploads the rest and completes', async () => {
    const t = await recording()
    t.pipelines[0]!.chunk('a')
    t.pipelines[0]!.chunk('b')
    t.advance(9000)
    await t.controller.stop('user')
    expect(log.indexOf('recorder:stop')).toBeLessThan(log.indexOf('api:/recording/stop'))
    expect(log.indexOf('api:/recording/stop')).toBeLessThan(log.indexOf('complete'))
    expect(t.transport.puts).toEqual([0, 1, 2])
    expect(t.transport.completes).toEqual([{ chunkCount: 3, durationMs: 9000 }])
    expect(t.pipelines[0]!.disposed).toBe(true)
    expect(t.notify.success).toHaveBeenCalledWith(MESSAGES.savedServer)
    // Counters stay readable after the run (test hooks).
    expect(t.controller.state.value).toMatchObject({ phase: 'idle', chunksProduced: 3, chunksAcked: 3, error: null })
  })

  it('stops without calling stop when a co-host turned the indicator off, and still completes', async () => {
    const t = await recording()
    t.pipelines[0]!.chunk()
    t.setRecording(null)
    await vi.waitFor(() => expect(t.controller.state.value.phase).toBe('idle'))
    expect(t.calls.map((call) => call.path)).toEqual(['/recording/start'])
    expect(t.transport.completes).toEqual([{ chunkCount: 2, durationMs: 0 }])
  })

  it('stops when the indicator changes to another recording', async () => {
    const t = await recording()
    t.setRecording(indicator('2026-10-03T12:05:00.000Z'))
    await vi.waitFor(() => expect(t.controller.state.value.phase).toBe('idle'))
    expect(t.pipelines[0]!.stopped).toBe(true)
  })

  it('ignores the first metadata arriving after the 201 and repeated identical metadata', async () => {
    const t = setup()
    const started = t.controller.start('server')
    await t.acknowledge()
    await started
    t.controller.onIndicator(indicator())
    t.controller.onIndicator(indicator())
    expect(t.controller.state.value.phase).toBe('recording')
  })

  it('stops when the call ends, but not on a reconnect', async () => {
    const t = await recording()
    t.controller.onPhase('reconnecting')
    expect(t.controller.state.value.phase).toBe('recording')
    t.phase.value = 'left'
    t.controller.onPhase('left')
    await vi.waitFor(() => expect(t.controller.state.value.phase).toBe('idle'))
    // No longer a participant: complete turns the indicator off.
    expect(t.calls.map((call) => call.path)).toEqual(['/recording/start'])
    expect(t.transport.completes).toHaveLength(1)
  })

  it('warns 5 minutes before the time limit and stops at the limit', async () => {
    const t = await recording('server', { maxDurationMs: 6 * 60_000 })
    t.advance(59_000)
    t.pipelines[0]!.tick()
    expect(t.notify.info).not.toHaveBeenCalled()
    t.advance(1000)
    t.pipelines[0]!.tick()
    t.pipelines[0]!.tick()
    expect(t.notify.info).toHaveBeenCalledTimes(1)
    expect(t.notify.info).toHaveBeenCalledWith(MESSAGES.limitSoon)
    t.advance(5 * 60_000)
    t.pipelines[0]!.tick()
    expect(t.notify.info).toHaveBeenCalledWith(MESSAGES.limitReached)
    await vi.waitFor(() => expect(t.controller.state.value.phase).toBe('idle'))
    expect(t.calls.map((call) => call.path)).toContain('/recording/stop')
  })

  it('stops with an error when the indicator never reached the meeting', async () => {
    const t = setup()
    const started = t.controller.start('server')
    await t.acknowledge()
    await started
    t.advance(INDICATOR_TIMEOUT_MS - 1)
    t.pipelines[0]!.tick()
    expect(t.controller.state.value.phase).toBe('recording')
    t.advance(2)
    t.pipelines[0]!.tick()
    await vi.waitFor(() => expect(t.controller.state.value.phase).toBe('idle'))
    expect(t.notify.error).toHaveBeenCalledWith(MESSAGES.indicatorMissing)
    expect(t.calls.map((call) => call.path)).toContain('/recording/stop')
  })

  it('stops with an error when MediaRecorder fails', async () => {
    const t = await recording()
    t.pipelines[0]!.options.onError(new Error('encoder'))
    await vi.waitFor(() => expect(t.controller.state.value.phase).toBe('idle'))
    expect(t.notify.error).toHaveBeenCalledWith(MESSAGES.recorderError)
    expect(t.transport.completes).toHaveLength(1)
  })

  it('stops recording when the upload fails for good (quota)', async () => {
    const t = await recording()
    t.transport.putResponse = { status: 409, body: { data: { code: 'RECORDING_QUOTA_EXCEEDED' } } }
    t.pipelines[0]!.chunk()
    await vi.waitFor(() => expect(t.controller.state.value.phase).toBe('idle'))
    expect(t.notify.error).toHaveBeenCalledWith(MESSAGES.quotaFull)
    expect(t.calls.map((call) => call.path)).toContain('/recording/stop')
    expect(t.transport.completes).toEqual([])
  })

  it('saves local recordings on this device and uploads nothing', async () => {
    const t = await recording('local')
    t.pipelines[0]!.chunk('a')
    t.pipelines[0]!.chunk('b')
    expect(t.controller.state.value.chunksProduced).toBe(2)
    await t.controller.stop('user')
    expect(t.transport.puts).toEqual([])
    expect(t.saved).toHaveLength(1)
    expect(t.saved[0]!.parts).toHaveLength(3)
    expect(t.saved[0]!.name).toMatch(/^blinq-abc-defg-hjk-\d{4}-\d{2}-\d{2}-\d{4}\.webm$/)
    expect(t.notify.success).toHaveBeenCalledWith(MESSAGES.savedLocal)
    expect(t.calls.map((call) => call.path)).toEqual(['/recording/start', '/recording/stop'])
  })

  it('is idempotent', async () => {
    const t = await recording()
    await Promise.all([t.controller.stop('user'), t.controller.stop('user'), t.controller.stop('indicator')])
    expect(log.filter((entry) => entry === 'recorder:stop')).toHaveLength(1)
    expect(t.transport.completes).toHaveLength(1)
  })

  it('a stop requested while starting runs right after the 201', async () => {
    const t = setup()
    const started = t.controller.start('server')
    void t.controller.stop('user')
    await t.acknowledge()
    await started
    await vi.waitFor(() => expect(t.controller.state.value.phase).toBe('idle'))
    expect(t.pipelines[0]!.started).toBe(true)
    expect(t.pipelines[0]!.stopped).toBe(true)
  })
})
