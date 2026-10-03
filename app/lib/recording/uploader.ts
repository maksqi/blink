/**
 * Chunk uploader for server recordings (docs/API.md §8): an ordered queue with one `PUT
 * /api/recordings/:id/chunks/:seq` in flight, then `POST /api/recordings/:id/complete` after the last acknowledgement.
 *
 * - `seq` counts from 0 in production order; a chunk leaves the queue only when the server acknowledged it (2xx), so a
 *   retry resends the same `seq` (the server replaces it).
 * - Network errors, 5xx, 408 and 429 are retried forever with exponential backoff and jitter (0.5 s → 30 s); a
 *   `Retry-After` header wins over the backoff. The server's finalize task ends a recording whose uploads stopped,
 *   after which chunks answer 409 `not_recording`, so a dead server does not keep the uploader busy for ever.
 * - 409 `not_recording` stops uploading locally (the recording was finalized elsewhere); any other 4xx stops with an
 *   error (quota, size, forbidden, gaps).
 * - A backlog above 256 MiB flags `behind` ("Uploading is falling behind"); nothing is dropped.
 *
 * Timers, randomness and the transport are injected, so the logic is unit-tested with fake timers.
 */

export const MIN_BACKOFF_MS = 500
export const MAX_BACKOFF_MS = 30_000
/** Upper bound for a server's `Retry-After` (decision). */
export const MAX_RETRY_AFTER_MS = 60_000
export const MAX_BACKLOG_BYTES = 256 * 1024 * 1024

export interface UploadResponse {
  status: number
  /** The `Retry-After` header, if any. */
  retryAfter?: string | null
  /** Parsed JSON body (`{ data: { code, details } }` for errors), if any. */
  body?: unknown
}

export interface UploadTransport {
  putChunk(seq: number, blob: Blob): Promise<UploadResponse>
  complete(body: { chunkCount: number; durationMs: number }): Promise<UploadResponse>
}

export type UploaderStatus = 'uploading' | 'completing' | 'completed' | 'stopped' | 'failed'

export interface UploaderState {
  status: UploaderStatus
  /** Chunks handed to the uploader (the next `seq`). */
  produced: number
  /** Chunks the server acknowledged. */
  acked: number
  /** Failed attempts that were retried (chunks and complete). */
  retries: number
  backlogBytes: number
  backlogChunks: number
  /** The backlog is above `maxBacklogBytes`. */
  behind: boolean
  /** Error code of a final failure (`RECORDING_QUOTA_EXCEEDED`, `FORBIDDEN`, …), or `not_recording` when stopped. */
  errorCode: string | null
}

export interface UploaderOptions {
  transport: UploadTransport
  maxBacklogBytes?: number
  random?: () => number
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /** Wall clock for HTTP-date `Retry-After` values. */
  now?: () => number
  onChange?: (state: UploaderState) => void
}

type Outcome =
  | { kind: 'ok' }
  | { kind: 'retry'; delayMs: number | null }
  | { kind: 'not_recording' }
  | { kind: 'fatal'; code: string }

/** Backoff before retry number `attempt` (1-based): 0.5 s doubling to 30 s, ±25 % jitter, clamped to that range. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, Math.floor(attempt) - 1)
  const base = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** Math.min(exponent, 16))
  const jittered = base * (0.75 + 0.5 * Math.min(Math.max(random(), 0), 1))
  return Math.round(Math.min(MAX_BACKOFF_MS, Math.max(MIN_BACKOFF_MS, jittered)))
}

/** `Retry-After` as milliseconds (delta seconds or an HTTP date), clamped to 0.5 s … 60 s; null when absent/invalid. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  let ms: number
  if (/^\d+$/.test(trimmed)) ms = Number(trimmed) * 1000
  else {
    const date = Date.parse(trimmed)
    if (Number.isNaN(date)) return null
    ms = date - now
  }
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(MIN_BACKOFF_MS, ms))
}

function errorData(body: unknown): { code?: string; reason?: string } {
  if (typeof body !== 'object' || body === null) return {}
  const data = (body as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return {}
  const code = (data as { code?: unknown }).code
  const details = (data as { details?: unknown }).details
  const reason = typeof details === 'object' && details !== null ? (details as { reason?: unknown }).reason : undefined
  return {
    code: typeof code === 'string' ? code : undefined,
    reason: typeof reason === 'string' ? reason : undefined,
  }
}

/** How the uploader treats a response. */
export function classifyResponse(response: UploadResponse, now: number = Date.now()): Outcome {
  const { status } = response
  if (status >= 200 && status < 300) return { kind: 'ok' }
  if (status === 408 || status === 429 || status >= 500) {
    return { kind: 'retry', delayMs: parseRetryAfter(response.retryAfter, now) }
  }
  const data = errorData(response.body)
  if (status === 409 && data.reason === 'not_recording') return { kind: 'not_recording' }
  return { kind: 'fatal', code: data.code ?? `HTTP_${status}` }
}

const TERMINAL: readonly UploaderStatus[] = ['completed', 'stopped', 'failed']

export class ChunkUploader {
  private readonly queue: Array<{ seq: number; blob: Blob }> = []
  private readonly state: UploaderState = {
    status: 'uploading',
    produced: 0,
    acked: 0,
    retries: 0,
    backlogBytes: 0,
    backlogChunks: 0,
    behind: false,
    errorCode: null,
  }

  private running = false
  private attempt = 0
  private finishing: { durationMs: number } | null = null
  private done: Promise<UploaderState> | null = null
  private resolveDone: ((state: UploaderState) => void) | null = null
  private sleeping: { handle: unknown; resolve: () => void } | null = null
  private readonly maxBacklog: number
  private readonly random: () => number
  private readonly setTimer: (callback: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void
  private readonly now: () => number

  constructor(private readonly options: UploaderOptions) {
    this.maxBacklog = options.maxBacklogBytes ?? MAX_BACKLOG_BYTES
    this.random = options.random ?? Math.random
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
    this.now = options.now ?? (() => Date.now())
  }

  snapshot(): UploaderState {
    return { ...this.state }
  }

  get terminal(): boolean {
    return TERMINAL.includes(this.state.status)
  }

  /** Queues the next chunk and returns its `seq` (null when empty or after the uploader stopped). */
  enqueue(blob: Blob): number | null {
    if (this.terminal || this.finishing || blob.size === 0) return null
    const seq = this.state.produced
    this.queue.push({ seq, blob })
    this.state.produced++
    this.state.backlogBytes += blob.size
    this.state.backlogChunks++
    this.state.behind = this.state.backlogBytes > this.maxBacklog
    this.emit()
    void this.pump()
    return seq
  }

  /** No more chunks: upload the rest, then complete. Resolves with the final state (also when it stopped or failed). */
  finish(durationMs: number): Promise<UploaderState> {
    if (!this.finishing) this.finishing = { durationMs: Math.max(0, Math.round(durationMs)) }
    const done = this.whenDone()
    void this.pump()
    return done
  }

  /** Gives up immediately (page teardown); queued chunks are dropped. */
  abort(): void {
    if (this.terminal) return
    this.end('stopped', this.state.errorCode)
  }

  private whenDone(): Promise<UploaderState> {
    if (!this.done) {
      this.done = new Promise((resolve) => {
        this.resolveDone = resolve
        if (this.terminal) resolve(this.snapshot())
      })
    }
    return this.done
  }

  private emit() {
    this.options.onChange?.(this.snapshot())
  }

  private end(status: UploaderStatus, errorCode: string | null) {
    this.state.status = status
    this.state.errorCode = errorCode
    if (this.sleeping) {
      this.clearTimer(this.sleeping.handle)
      this.sleeping.resolve()
      this.sleeping = null
    }
    this.emit()
    this.resolveDone?.(this.snapshot())
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const handle = this.setTimer(() => {
        this.sleeping = null
        resolve()
      }, ms)
      this.sleeping = { handle, resolve }
    })
  }

  private async attemptRequest(request: () => Promise<UploadResponse>): Promise<Outcome> {
    try {
      return classifyResponse(await request(), this.now())
    } catch {
      // fetch rejects only for network failures (offline, reset, aborted by a proxy).
      return { kind: 'retry', delayMs: null }
    }
  }

  /** Applies a non-ok outcome; returns false when the uploader ended. */
  private async handleFailure(outcome: Exclude<Outcome, { kind: 'ok' }>): Promise<boolean> {
    if (outcome.kind === 'not_recording') {
      this.end('stopped', 'not_recording')
      return false
    }
    if (outcome.kind === 'fatal') {
      this.end('failed', outcome.code)
      return false
    }
    this.attempt++
    this.state.retries++
    this.emit()
    await this.sleep(outcome.delayMs ?? backoffDelay(this.attempt, this.random))
    return !this.terminal
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (!this.terminal) {
        const head = this.queue[0]
        if (head) {
          const outcome = await this.attemptRequest(() => this.options.transport.putChunk(head.seq, head.blob))
          if (this.terminal) break
          if (outcome.kind === 'ok') {
            this.queue.shift()
            this.attempt = 0
            this.state.acked++
            this.state.backlogBytes = Math.max(0, this.state.backlogBytes - head.blob.size)
            this.state.backlogChunks = this.queue.length
            this.state.behind = this.state.backlogBytes > this.maxBacklog
            this.emit()
            continue
          }
          if (!(await this.handleFailure(outcome))) break
          continue
        }
        if (!this.finishing) break
        // Nothing was recorded: there is nothing to complete (the schema needs ≥ 1 chunk); the server's finalize
        // task fails the empty row (decision).
        if (this.state.produced === 0) {
          this.end('completed', null)
          break
        }
        if (this.state.status !== 'completing') {
          this.state.status = 'completing'
          this.emit()
        }
        const body = { chunkCount: this.state.produced, durationMs: this.finishing.durationMs }
        const outcome = await this.attemptRequest(() => this.options.transport.complete(body))
        if (this.terminal) break
        if (outcome.kind === 'ok') {
          this.end('completed', null)
          break
        }
        if (!(await this.handleFailure(outcome))) break
      }
    } finally {
      this.running = false
    }
  }
}
