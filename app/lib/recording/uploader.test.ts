import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  backoffDelay,
  ChunkUploader,
  classifyResponse,
  MAX_BACKOFF_MS,
  MIN_BACKOFF_MS,
  parseRetryAfter,
  type UploaderState,
  type UploadResponse,
  type UploadTransport,
} from './uploader'

type Step = UploadResponse | 'network' | Promise<UploadResponse>

/** A transport that answers from a script per request (default 204/202) and records every call. */
class FakeTransport implements UploadTransport {
  readonly calls: Array<{ kind: 'put'; seq: number; size: number } | { kind: 'complete'; body: unknown }> = []
  readonly script: Step[] = []

  private next(fallback: UploadResponse): Promise<UploadResponse> {
    const step = this.script.shift()
    if (step === undefined) return Promise.resolve(fallback)
    if (step === 'network') return Promise.reject(new TypeError('Failed to fetch'))
    return Promise.resolve(step)
  }

  putChunk(seq: number, blob: Blob) {
    this.calls.push({ kind: 'put', seq, size: blob.size })
    return this.next({ status: 204 })
  }

  complete(body: { chunkCount: number; durationMs: number }) {
    this.calls.push({ kind: 'complete', body })
    return this.next({ status: 202, body: { status: 'processing' } })
  }

  get puts() {
    return this.calls.filter((call) => call.kind === 'put').map((call) => (call as { seq: number }).seq)
  }
}

const blob = (size: number) => new Blob([new Uint8Array(size)])
const conflict = (reason: string, code = 'CONFLICT'): UploadResponse => ({
  status: 409,
  body: { statusCode: 409, data: { code, details: { reason } } },
})

function setup(options: { maxBacklogBytes?: number; random?: () => number } = {}) {
  const transport = new FakeTransport()
  const states: UploaderState[] = []
  const uploader = new ChunkUploader({
    transport,
    random: options.random ?? (() => 0.5),
    maxBacklogBytes: options.maxBacklogBytes,
    onChange: (state) => states.push(state),
    now: () => Date.now(),
  })
  return { transport, uploader, states }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-03T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('backoffDelay', () => {
  it('starts at 0.5 s, doubles and caps at 30 s', () => {
    const mid = () => 0.5
    expect([1, 2, 3, 4, 5, 6, 7, 8, 20].map((attempt) => backoffDelay(attempt, mid))).toEqual([
      500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ])
  })

  it('adds jitter of ±25 % within 0.5 s … 30 s', () => {
    expect(backoffDelay(3, () => 0)).toBe(1500)
    expect(backoffDelay(3, () => 1)).toBe(2500)
    expect(backoffDelay(1, () => 0)).toBe(MIN_BACKOFF_MS)
    expect(backoffDelay(10, () => 1)).toBe(MAX_BACKOFF_MS)
    for (let attempt = 1; attempt < 30; attempt++) {
      const delay = backoffDelay(attempt)
      expect(delay).toBeGreaterThanOrEqual(MIN_BACKOFF_MS)
      expect(delay).toBeLessThanOrEqual(MAX_BACKOFF_MS)
    }
  })
})

describe('parseRetryAfter', () => {
  it('reads delta seconds and HTTP dates', () => {
    const now = Date.parse('2026-10-03T12:00:00Z')
    expect(parseRetryAfter('3', now)).toBe(3000)
    expect(parseRetryAfter('Sat, 03 Oct 2026 12:00:07 GMT', now)).toBe(7000)
  })

  it('clamps to 0.5 s … 60 s and ignores garbage', () => {
    expect(parseRetryAfter('0')).toBe(500)
    expect(parseRetryAfter('3600')).toBe(60_000)
    expect(parseRetryAfter('soon')).toBeNull()
    expect(parseRetryAfter('')).toBeNull()
    expect(parseRetryAfter(null)).toBeNull()
  })
})

describe('classifyResponse', () => {
  it('retries 5xx, 408 and 429, stops on not_recording and fails on other 4xx', () => {
    expect(classifyResponse({ status: 204 })).toEqual({ kind: 'ok' })
    expect(classifyResponse({ status: 202 })).toEqual({ kind: 'ok' })
    for (const status of [500, 502, 503, 504, 408, 429]) expect(classifyResponse({ status }).kind).toBe('retry')
    expect(classifyResponse({ status: 429, retryAfter: '2' })).toEqual({ kind: 'retry', delayMs: 2000 })
    expect(classifyResponse(conflict('not_recording'))).toEqual({ kind: 'not_recording' })
    expect(classifyResponse(conflict('chunk_gap'))).toEqual({ kind: 'fatal', code: 'CONFLICT' })
    expect(classifyResponse({ status: 409, body: { data: { code: 'RECORDING_QUOTA_EXCEEDED' } } })).toEqual({
      kind: 'fatal',
      code: 'RECORDING_QUOTA_EXCEEDED',
    })
    expect(classifyResponse({ status: 413 })).toEqual({ kind: 'fatal', code: 'HTTP_413' })
    expect(classifyResponse({ status: 403, body: 'nope' })).toEqual({ kind: 'fatal', code: 'HTTP_403' })
  })
})

describe('ChunkUploader', () => {
  it('uploads in order with one request in flight, then completes after the last ack', async () => {
    const { transport, uploader } = setup()
    let release!: (response: UploadResponse) => void
    transport.script.push(new Promise<UploadResponse>((resolve) => (release = resolve)))

    expect(uploader.enqueue(blob(10))).toBe(0)
    expect(uploader.enqueue(blob(20))).toBe(1)
    expect(uploader.enqueue(blob(30))).toBe(2)
    await vi.advanceTimersByTimeAsync(0)
    // Chunk 0 is in flight; nothing else was sent.
    expect(transport.puts).toEqual([0])
    expect(uploader.snapshot()).toMatchObject({ produced: 3, acked: 0, backlogBytes: 60, backlogChunks: 3 })

    release({ status: 204 })
    const done = uploader.finish(12_345)
    const state = await done
    expect(transport.calls).toEqual([
      { kind: 'put', seq: 0, size: 10 },
      { kind: 'put', seq: 1, size: 20 },
      { kind: 'put', seq: 2, size: 30 },
      { kind: 'complete', body: { chunkCount: 3, durationMs: 12_345 } },
    ])
    expect(state).toMatchObject({ status: 'completed', produced: 3, acked: 3, backlogBytes: 0, retries: 0 })
  })

  it('empty blobs consume no seq', async () => {
    const { transport, uploader } = setup()
    expect(uploader.enqueue(blob(0))).toBeNull()
    expect(uploader.enqueue(blob(5))).toBe(0)
    expect(uploader.enqueue(new Blob([]))).toBeNull()
    expect(uploader.enqueue(blob(5))).toBe(1)
    await uploader.finish(1000)
    expect(transport.puts).toEqual([0, 1])
  })

  it('retries network errors and 5xx with exponential backoff and resends the same seq', async () => {
    const { transport, uploader } = setup()
    transport.script.push('network', { status: 503 }, { status: 500 })
    uploader.enqueue(blob(4))
    uploader.enqueue(blob(4))

    await vi.advanceTimersByTimeAsync(0)
    expect(transport.puts).toEqual([0])
    await vi.advanceTimersByTimeAsync(499)
    expect(transport.puts).toEqual([0])
    await vi.advanceTimersByTimeAsync(1)
    expect(transport.puts).toEqual([0, 0])
    await vi.advanceTimersByTimeAsync(999)
    expect(transport.puts).toEqual([0, 0])
    await vi.advanceTimersByTimeAsync(1)
    expect(transport.puts).toEqual([0, 0, 0])
    await vi.advanceTimersByTimeAsync(2000)
    // Third retry succeeded; the backoff resets for chunk 1.
    expect(transport.puts).toEqual([0, 0, 0, 0, 1])
    expect(uploader.snapshot()).toMatchObject({ acked: 2, retries: 3 })

    const state = await uploader.finish(8000)
    expect(state.status).toBe('completed')
  })

  it('retries 408 and 429 and honors Retry-After', async () => {
    const { transport, uploader } = setup()
    transport.script.push({ status: 429, retryAfter: '5' }, { status: 408 })
    uploader.enqueue(blob(1))
    await vi.advanceTimersByTimeAsync(4999)
    expect(transport.puts).toEqual([0])
    await vi.advanceTimersByTimeAsync(1)
    expect(transport.puts).toEqual([0, 0])
    // 408 without Retry-After: the second backoff step (1 s).
    await vi.advanceTimersByTimeAsync(999)
    expect(transport.puts).toEqual([0, 0])
    await vi.advanceTimersByTimeAsync(1)
    expect(transport.puts).toEqual([0, 0, 0])
    expect(uploader.snapshot()).toMatchObject({ acked: 1, retries: 2 })
  })

  it('stops locally on 409 not_recording and drops the rest', async () => {
    const { transport, uploader } = setup()
    transport.script.push({ status: 204 }, conflict('not_recording'))
    uploader.enqueue(blob(1))
    uploader.enqueue(blob(1))
    uploader.enqueue(blob(1))
    const state = await uploader.finish(5000)
    expect(transport.puts).toEqual([0, 1])
    expect(transport.calls.some((call) => call.kind === 'complete')).toBe(false)
    expect(state).toMatchObject({ status: 'stopped', errorCode: 'not_recording', acked: 1 })
    expect(uploader.enqueue(blob(1))).toBeNull()
  })

  it('stops with an error on other 4xx', async () => {
    const { transport, uploader } = setup()
    transport.script.push({ status: 409, body: { data: { code: 'RECORDING_QUOTA_EXCEEDED' } } })
    uploader.enqueue(blob(1))
    uploader.enqueue(blob(1))
    const state = await uploader.finish(1000)
    expect(transport.puts).toEqual([0])
    expect(state).toMatchObject({ status: 'failed', errorCode: 'RECORDING_QUOTA_EXCEEDED' })
  })

  it('retries the complete request and fails on a chunk count mismatch', async () => {
    const first = setup()
    first.transport.script.push({ status: 204 }, { status: 502 })
    first.uploader.enqueue(blob(1))
    const done = first.uploader.finish(2000)
    await vi.advanceTimersByTimeAsync(500)
    expect(await done).toMatchObject({ status: 'completed', retries: 1 })
    expect(first.transport.calls.filter((call) => call.kind === 'complete')).toHaveLength(2)

    const second = setup()
    second.transport.script.push({ status: 204 }, conflict('chunk_count_mismatch'))
    second.uploader.enqueue(blob(1))
    expect(await second.uploader.finish(2000)).toMatchObject({ status: 'failed', errorCode: 'CONFLICT' })
  })

  it('reports completing while the complete request runs', async () => {
    const { uploader, states } = setup()
    uploader.enqueue(blob(1))
    await uploader.finish(1000)
    expect(states.map((state) => state.status)).toContain('completing')
    expect(states.at(-1)?.status).toBe('completed')
  })

  it('completes nothing when no chunk was produced', async () => {
    const { transport, uploader } = setup()
    expect(await uploader.finish(100)).toMatchObject({ status: 'completed', produced: 0 })
    expect(transport.calls).toEqual([])
  })

  it('flags a backlog above the limit and clears it once acknowledged', async () => {
    const { transport, uploader, states } = setup({ maxBacklogBytes: 100 })
    let release!: (response: UploadResponse) => void
    transport.script.push(new Promise<UploadResponse>((resolve) => (release = resolve)))
    uploader.enqueue(blob(60))
    expect(uploader.snapshot().behind).toBe(false)
    uploader.enqueue(blob(60))
    expect(uploader.snapshot()).toMatchObject({ behind: true, backlogBytes: 120 })
    release({ status: 204 })
    await vi.advanceTimersByTimeAsync(0)
    expect(uploader.snapshot()).toMatchObject({ behind: false })
    expect(states.some((state) => state.behind)).toBe(true)
  })

  it('accepts no chunks after finish and aborts cleanly while waiting to retry', async () => {
    const { transport, uploader } = setup()
    transport.script.push({ status: 503 })
    uploader.enqueue(blob(1))
    const done = uploader.finish(1000)
    expect(uploader.enqueue(blob(1))).toBeNull()
    await vi.advanceTimersByTimeAsync(100)
    uploader.abort()
    expect(await done).toMatchObject({ status: 'stopped' })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(transport.puts).toEqual([0])
  })
})
