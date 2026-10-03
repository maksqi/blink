/**
 * MediaRecorder wrapper: one recorder over the canvas track and the mixed audio track, timeslice 4 s. Chunks are
 * consecutive slices of one stream (only chunk 0 carries the container header), numbered in production order; empty
 * blobs consume no number. An `error` event ends the recording (the controller then stops and completes).
 */

export const CHUNK_INTERVAL_MS = 4000

/** The MediaRecorder surface used here (structural, so tests can fake it). */
export interface MediaRecorderLike {
  readonly state: RecordingState
  readonly mimeType: string
  ondataavailable: ((event: { data: Blob }) => void) | null
  onerror: ((event: Event) => void) | null
  onstop: ((event: Event) => void) | null
  start(timeslice?: number): void
  stop(): void
}

export interface ChunkRecorderOptions {
  stream: MediaStream
  mimeType: string
  videoBitsPerSecond: number
  audioBitsPerSecond: number
  timesliceMs?: number
  onChunk: (blob: Blob, index: number) => void
  onError: (error: unknown) => void
  createRecorder?: (stream: MediaStream, options: MediaRecorderOptions) => MediaRecorderLike
}

export class ChunkRecorder {
  readonly recorder: MediaRecorderLike
  private produced = 0
  private stopped: Promise<void> | null = null
  private resolveStopped: (() => void) | null = null
  private started = false

  /** Throws when the browser refuses the options (the caller reports it before anything is published). */
  constructor(private readonly options: ChunkRecorderOptions) {
    const create =
      options.createRecorder ??
      ((stream: MediaStream, recorderOptions: MediaRecorderOptions) =>
        new MediaRecorder(stream, recorderOptions) as unknown as MediaRecorderLike)
    this.recorder = create(options.stream, {
      mimeType: options.mimeType,
      videoBitsPerSecond: options.videoBitsPerSecond,
      audioBitsPerSecond: options.audioBitsPerSecond,
    })
    this.recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return
      this.options.onChunk(event.data, this.produced++)
    }
    this.recorder.onerror = (event) => {
      const error = (event as Event & { error?: unknown }).error ?? event
      this.options.onError(error)
    }
    this.recorder.onstop = () => {
      this.resolveStopped?.()
    }
  }

  /** Non-empty chunks produced so far. */
  get chunks(): number {
    return this.produced
  }

  get mimeType(): string {
    return this.recorder.mimeType || this.options.mimeType
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.recorder.start(this.options.timesliceMs ?? CHUNK_INTERVAL_MS)
  }

  /** Stops capturing now; resolves after the final chunk was delivered (the `stop` event). */
  stop(): Promise<void> {
    if (this.stopped) return this.stopped
    this.stopped = new Promise<void>((resolve) => {
      this.resolveStopped = resolve
    })
    if (this.recorder.state === 'inactive') this.resolveStopped?.()
    else {
      try {
        this.recorder.stop()
      } catch {
        this.resolveStopped?.()
      }
    }
    return this.stopped
  }
}
