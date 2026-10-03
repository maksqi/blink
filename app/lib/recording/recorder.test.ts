import { describe, expect, it } from 'vitest'
import { CHUNK_INTERVAL_MS, ChunkRecorder, type MediaRecorderLike } from './recorder'

class FakeRecorder implements MediaRecorderLike {
  state: RecordingState = 'inactive'
  mimeType = ''
  timeslice: number | undefined
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onstop: ((event: Event) => void) | null = null
  constructor(readonly options: MediaRecorderOptions) {}
  start(timeslice?: number) {
    this.state = 'recording'
    this.timeslice = timeslice
  }
  stop() {
    this.state = 'inactive'
    // Like the browser: the final dataavailable comes first, then stop (asynchronously).
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(['tail']) })
      this.onstop?.(new Event('stop'))
    })
  }
  emit(data: Blob) {
    this.ondataavailable?.({ data })
  }
}

function setup() {
  const chunks: Array<{ blob: Blob; index: number }> = []
  const errors: unknown[] = []
  let fake!: FakeRecorder
  const recorder = new ChunkRecorder({
    stream: {} as MediaStream,
    mimeType: 'video/webm;codecs=vp8,opus',
    videoBitsPerSecond: 1_500_000,
    audioBitsPerSecond: 128_000,
    onChunk: (blob, index) => chunks.push({ blob, index }),
    onError: (error) => errors.push(error),
    createRecorder: (_stream, options) => (fake = new FakeRecorder(options)),
  })
  return { recorder, fake, chunks, errors }
}

describe('ChunkRecorder', () => {
  it('passes the MIME type and bitrates and records with a 4 s timeslice', () => {
    const { recorder, fake } = setup()
    expect(fake.options).toEqual({
      mimeType: 'video/webm;codecs=vp8,opus',
      videoBitsPerSecond: 1_500_000,
      audioBitsPerSecond: 128_000,
    })
    expect(fake.state).toBe('inactive')
    recorder.start()
    expect(fake.timeslice).toBe(CHUNK_INTERVAL_MS)
    expect(CHUNK_INTERVAL_MS).toBe(4000)
  })

  it('numbers non-empty chunks in order; empty blobs consume no number', () => {
    const { recorder, fake, chunks } = setup()
    recorder.start()
    fake.emit(new Blob(['a']))
    fake.emit(new Blob([]))
    fake.emit(new Blob(['b']))
    expect(chunks.map((chunk) => chunk.index)).toEqual([0, 1])
    expect(recorder.chunks).toBe(2)
  })

  it('resolves stop after the final chunk was delivered', async () => {
    const { recorder, fake, chunks } = setup()
    recorder.start()
    fake.emit(new Blob(['a']))
    await recorder.stop()
    expect(chunks.map((chunk) => chunk.index)).toEqual([0, 1])
    expect(await chunks[1]!.blob.text()).toBe('tail')
    // Idempotent.
    await recorder.stop()
  })

  it('resolves stop at once when it never started', async () => {
    const { recorder } = setup()
    await recorder.stop()
  })

  it('reports recorder errors', () => {
    const { recorder, fake, errors } = setup()
    recorder.start()
    const event = Object.assign(new Event('error'), { error: new Error('encoder') })
    fake.onerror?.(event)
    expect(errors).toEqual([event.error])
  })

  it('reports the MIME type the browser used, else the requested one', () => {
    const { recorder, fake } = setup()
    expect(recorder.mimeType).toBe('video/webm;codecs=vp8,opus')
    fake.mimeType = 'video/webm; codecs="vp8, opus"'
    expect(recorder.mimeType).toBe('video/webm; codecs="vp8, opus"')
  })
})
