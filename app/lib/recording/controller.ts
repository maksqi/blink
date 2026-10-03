/**
 * Recording controller: one per call session (created by the recording feature's `setup`). It drives the capture
 * pipeline (pipeline.ts) and either the uploader (server mode) or the in-memory parts (local-only mode).
 * docs/stages/08-recording.md, docs/ARCHITECTURE.md §6.5, docs/SECURITY.md §6.
 *
 * Start: the pipeline is built synchronously inside the click (so the AudioContext may start), then
 * `POST /api/calls/:roomId/recording/start`, and only after the 201 does MediaRecorder start: nothing is captured
 * before the server published the REC indicator. A failed start disposes the pipeline.
 *
 * Stop (button, time limit, recorder error, upload failure): MediaRecorder stops first, so nothing is captured after
 * the indicator goes off, then `POST …/recording/stop`, then the remaining chunks upload and `complete` runs (server)
 * or the file is saved on this device (local). When the indicator turns off or changes without us (a co-host stopped
 * it, the server finalized it) or the call ends, the controller stops the same way without calling stop.
 */
import { shallowRef, type ShallowRef } from 'vue'
import type { StartRecordingResponse } from '#shared/schemas/recordings'
import type { CallContext, CallPhase } from '../contracts/call'
import { testHooks } from '../contracts/test-hooks'
import type { FrameClock } from './clock'
import { canvasSizeFor, type RecordingResolution } from './layout'
import { localFileName, saveRecordingFile } from './local-file'
import { pickRecordingMime } from './mime'
import { createCapturePipeline, type CapturePipeline, type CreateCapturePipeline } from './pipeline'
import { recordingTransport } from './transport'
import { ChunkUploader, type UploaderState, type UploadTransport } from './uploader'

export type RecordingMode = 'server' | 'local'
export type RecordingPhase = 'idle' | 'starting' | 'recording' | 'stopping' | 'finishing'
export type StopReason = 'user' | 'limit' | 'error' | 'indicator' | 'phase' | 'dispose'

export interface RecordingConfig {
  enabled: boolean
  maxDurationMinutes: number
  maxResolution: RecordingResolution
}

export interface RecordingState {
  phase: RecordingPhase
  mode: RecordingMode | null
  recordingId: string | null
  mime: string | null
  /** Epoch ms when MediaRecorder started. */
  startedAt: number | null
  maxDurationMs: number | null
  chunksProduced: number
  chunksAcked: number
  retries: number
  backlogBytes: number
  backlogChunks: number
  /** The upload backlog is above 256 MiB. */
  behind: boolean
  /** The last error shown to the recorder, if any. */
  error: string | null
}

export interface Notifier {
  info(message: string): void
  success(message: string): void
  error(message: string): void
}

export interface ControllerDeps {
  createClock: () => FrameClock
  notify: Notifier
  fetch?: (input: string, init: RequestInit) => Promise<Response>
  isTypeSupported?: (mime: string) => boolean
  now?: () => number
  document?: Document
  /** Overrides (tests). */
  createPipeline?: CreateCapturePipeline
  transport?: (recordingId: string) => UploadTransport
  saveFile?: (parts: readonly Blob[], mime: string, fileName: string) => void
}

/** Warn this long before the time limit. */
export const LIMIT_WARNING_MS = 5 * 60_000
/** Stop when the server's indicator has not shown up this long after the start (decision). */
export const INDICATOR_TIMEOUT_MS = 10_000

export const MESSAGES = {
  unsupported: "This browser can't record meetings. Use a current version of Chrome, Edge, Firefox or Safari.",
  pipeline: "Recording couldn't start in this browser. Reload the page and try again.",
  startFailed: "Recording didn't start. Try again.",
  limitSoon: 'The recording stops in 5 minutes because it reaches the time limit.',
  limitReached: 'The recording reached the time limit and stopped.',
  recorderError: 'The recording stopped because of a browser error. What was recorded so far is kept.',
  indicatorMissing: 'The recording stopped because the recording indicator did not reach the meeting.',
  savedServer: 'Recording saved. It appears in Recordings once it has been processed.',
  savedLocal: 'Recording saved to this device.',
  saveFailed: "The recording couldn't be saved on this device.",
  stoppedByServer: 'The server ended the recording. The part uploaded so far is kept.',
  uploadFailed: "The recording couldn't be uploaded completely. The part uploaded so far is kept.",
  quotaFull: 'Your recording storage quota is full. The part uploaded so far is kept.',
  stopOthersFailed: "The recording didn't stop. Try again.",
} as const

const IDLE: RecordingState = {
  phase: 'idle',
  mode: null,
  recordingId: null,
  mime: null,
  startedAt: null,
  maxDurationMs: null,
  chunksProduced: 0,
  chunksAcked: 0,
  retries: 0,
  backlogBytes: 0,
  backlogChunks: 0,
  behind: false,
  error: null,
}

let forcedMime: string | null = null

/** Test hook `forceRecordingMime`: restricts the MIME choice to one family (null clears it). */
export function setForcedRecordingMime(mime: string | null): void {
  forcedMime = mime && mime.trim() ? mime.trim() : null
}

function errorText(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown } | null)?.message
  const named = (error as { name?: unknown } | null)?.name
  // ApiError carries an English message for the UI; anything else gets the generic text.
  return named === 'ApiError' && typeof message === 'string' && message ? message : fallback
}

interface Run {
  mode: RecordingMode
  pipeline: CapturePipeline
  recordingId: string
  startedAt: number
  uploader: ChunkUploader | null
  parts: Blob[]
  /** `startedAt` of the indicator once seen in the room metadata. */
  seenIndicator: string | null
  warned: boolean
  /** Error message shown when the run ends. */
  stopMessage: string | null
}

export class RecordingController {
  readonly state: ShallowRef<RecordingState> = shallowRef({ ...IDLE })
  readonly config: ShallowRef<RecordingConfig | null> = shallowRef(null)

  private run: Run | null = null
  /** The pipeline while the start request runs. */
  private starting: CapturePipeline | null = null
  private pendingStop: StopReason | null = null
  private stopping: Promise<void> | null = null
  private disposed = false
  private readonly now: () => number
  private readonly doc: Document | undefined

  constructor(
    private readonly ctx: CallContext,
    private readonly deps: ControllerDeps,
  ) {
    this.now = deps.now ?? (() => Date.now())
    this.doc = deps.document ?? (typeof document === 'undefined' ? undefined : document)
  }

  /** The recorder side is busy (starting, recording, stopping or uploading): leaving the page loses data. */
  get busy(): boolean {
    return this.state.value.phase !== 'idle'
  }

  // ---- Start ---------------------------------------------------------------------------------------------------------

  /**
   * Starts a recording. Call it from the click handler: the pipeline (and its AudioContext) is created before the
   * first await. Resolves true once MediaRecorder runs; on failure it shows the reason and resolves false.
   */
  async start(mode: RecordingMode): Promise<boolean> {
    if (this.disposed || this.state.value.phase !== 'idle') return false
    const config = this.config.value
    if (!config?.enabled || this.ctx.phase.value !== 'inCall') return false

    const isTypeSupported =
      this.deps.isTypeSupported ??
      ((mime: string) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime))
    const mime = pickRecordingMime(isTypeSupported, forcedMime)
    if (!mime) return this.failStart(MESSAGES.unsupported)

    const canvas = canvasSizeFor(config.maxResolution)
    let pipeline: CapturePipeline
    try {
      pipeline = (this.deps.createPipeline ?? createCapturePipeline)({
        ctx: this.ctx,
        mime,
        resolution: config.maxResolution,
        createClock: this.deps.createClock,
        document: this.doc,
        onChunk: (blob) => this.onChunk(blob),
        onError: (error) => this.onRecorderError(error),
        onTick: () => this.onTick(),
      })
    } catch (error) {
      console.warn('blinq: recording pipeline failed', error instanceof Error ? error.name : 'error')
      return this.failStart(MESSAGES.pipeline)
    }

    this.pendingStop = null
    this.starting = pipeline
    this.update({ ...IDLE, phase: 'starting', mode, mime })

    let response: StartRecordingResponse
    try {
      response = await this.ctx.callApi<StartRecordingResponse>('/recording/start', {
        method: 'POST',
        body: { mode, mimeType: mime, width: canvas.width, height: canvas.height },
      })
    } catch (error) {
      this.starting = null
      pipeline.dispose()
      return this.failStart(errorText(error, MESSAGES.startFailed))
    }
    this.starting = null

    // The call ended or the page went away while the start request ran: the server cleans up (recorder left).
    if (this.disposed || this.pendingStop === 'phase' || this.pendingStop === 'dispose' || !this.inCall()) {
      pipeline.dispose()
      this.update({ ...IDLE })
      return false
    }

    const run: Run = {
      mode,
      pipeline,
      recordingId: response.recordingId,
      startedAt: this.now(),
      uploader: null,
      parts: [],
      // The metadata can arrive before the 201.
      seenIndicator: this.ctx.roomState.value?.recording?.startedAt ?? null,
      warned: false,
      stopMessage: null,
    }
    if (mode === 'server') {
      const transport =
        this.deps.transport?.(response.recordingId) ?? recordingTransport(response.recordingId, this.deps.fetch)
      run.uploader = new ChunkUploader({ transport, onChange: (state) => this.onUploader(run, state) })
    }
    this.run = run
    this.update({
      phase: 'recording',
      recordingId: response.recordingId,
      startedAt: run.startedAt,
      maxDurationMs: response.maxDurationMs,
    })

    try {
      pipeline.startRecorder()
    } catch (error) {
      console.warn('blinq: MediaRecorder did not start', error instanceof Error ? error.name : 'error')
      run.stopMessage = MESSAGES.pipeline
      await this.stop('error')
      return false
    }
    if (this.pendingStop) {
      const reason = this.pendingStop
      this.pendingStop = null
      void this.stop(reason)
    }
    return true
  }

  private failStart(message: string): false {
    this.update({ ...IDLE, error: message })
    this.deps.notify.error(message)
    return false
  }

  // ---- Stop ----------------------------------------------------------------------------------------------------------

  /** Stops, flushes and completes (server) or saves (local). Safe to call repeatedly and from any state. */
  stop(reason: StopReason): Promise<void> {
    if (this.state.value.phase === 'starting') {
      this.pendingStop ??= reason
      return Promise.resolve()
    }
    const run = this.run
    if (this.state.value.phase !== 'recording' || !run) return this.stopping ?? Promise.resolve()
    this.stopping = this.finishRun(run, reason).finally(() => {
      this.stopping = null
    })
    return this.stopping
  }

  private async finishRun(run: Run, reason: StopReason): Promise<void> {
    try {
      this.update({ phase: 'stopping' })
      // 1. Stop capturing: the final chunk is delivered before this resolves.
      await run.pipeline.stopRecorder()
      const durationMs = Math.max(0, this.now() - run.startedAt)
      run.pipeline.dispose()

      // 2. Indicator off for everyone. Not for 'indicator' (it is off or the server finalized it already), nor after
      //    the call ended or the page unmounted (no longer a participant: complete or the server's finalize does it).
      if ((reason === 'user' || reason === 'limit' || reason === 'error') && this.inCall()) {
        await this.ctx.callApi('/recording/stop', { method: 'POST' }).catch(() => undefined)
      }

      // 3. Upload the rest and complete, or save the file locally (best effort after an unmount: the page lives on).
      if (run.uploader) {
        this.update({ phase: 'finishing' })
        this.reportUpload(run, await run.uploader.finish(durationMs))
      } else {
        this.saveLocal(run)
      }
    } finally {
      if (run.stopMessage) this.deps.notify.error(run.stopMessage)
      if (this.run === run) this.run = null
      // The last run's id and counters stay readable (test hooks, diagnostics) until the next start resets them.
      this.update({ phase: 'idle', error: run.stopMessage, behind: false })
    }
  }

  private reportUpload(run: Run, result: UploaderState) {
    if (run.stopMessage) return
    if (result.status === 'completed') this.deps.notify.success(MESSAGES.savedServer)
    else if (result.status === 'stopped') this.deps.notify.info(MESSAGES.stoppedByServer)
    else run.stopMessage = result.errorCode === 'RECORDING_QUOTA_EXCEEDED' ? MESSAGES.quotaFull : MESSAGES.uploadFailed
  }

  private saveLocal(run: Run) {
    if (run.parts.length === 0) return
    const mime = this.state.value.mime ?? 'video/webm'
    const name = localFileName([this.ctx.roomName.value, this.ctx.slug.value], new Date(run.startedAt), mime)
    try {
      if (this.deps.saveFile) this.deps.saveFile(run.parts, mime, name)
      else if (this.doc) saveRecordingFile(run.parts, mime, name, this.doc)
      else return
      if (!run.stopMessage) this.deps.notify.success(MESSAGES.savedLocal)
    } catch (error) {
      console.warn('blinq: saving the recording failed', error instanceof Error ? error.name : 'error')
      run.stopMessage ??= MESSAGES.saveFailed
    } finally {
      run.parts = []
    }
  }

  // ---- Events from the call ------------------------------------------------------------------------------------------

  /** Room metadata changed: stop when our indicator turned off or became another one. */
  onIndicator(recording: { startedAt: string } | null): void {
    const run = this.run
    if (!run || this.state.value.phase !== 'recording') return
    if (recording) {
      if (run.seenIndicator === null) run.seenIndicator = recording.startedAt
      else if (run.seenIndicator !== recording.startedAt) void this.stop('indicator')
    } else if (run.seenIndicator !== null) {
      void this.stop('indicator')
    }
  }

  /** The call phase changed: anything but in-call (or a short reconnect) ends the recording (decision). */
  onPhase(phase: CallPhase): void {
    if (phase === 'inCall' || phase === 'reconnecting') return
    void this.stop('phase')
  }

  /** Stops the recording someone else in the meeting is making (any moderator with an account may). */
  async stopOthers(): Promise<boolean> {
    try {
      await this.ctx.callApi('/recording/stop', { method: 'POST' })
      return true
    } catch (error) {
      this.deps.notify.error(errorText(error, MESSAGES.stopOthersFailed))
      return false
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    // The rest still uploads after the page went away, but a failure no longer retries for ever (F-049).
    this.run?.uploader?.stopRetrying()
    void this.stop('dispose')
  }

  // ---- Internals -----------------------------------------------------------------------------------------------------

  private onTick() {
    const run = this.run
    const state = this.state.value
    if (__BLINQ_TEST_HOOKS__) {
      // Frames drawn, for the background-tab check (outside the reactive state: it changes 30 times a second).
      const recording = testHooks()?.state.recording as { framesDrawn?: number } | undefined
      const pipeline = run?.pipeline ?? this.starting
      if (recording && pipeline) recording.framesDrawn = pipeline.frameCount
    }
    if (!run || state.phase !== 'recording') return
    const elapsed = this.now() - run.startedAt
    const limit = state.maxDurationMs ?? 0
    if (limit > 0) {
      if (!run.warned && limit > LIMIT_WARNING_MS && elapsed >= limit - LIMIT_WARNING_MS) {
        run.warned = true
        this.deps.notify.info(MESSAGES.limitSoon)
      }
      if (elapsed >= limit) {
        this.deps.notify.info(MESSAGES.limitReached)
        void this.stop('limit')
        return
      }
    }
    if (run.seenIndicator === null && elapsed > INDICATOR_TIMEOUT_MS) {
      run.stopMessage ??= MESSAGES.indicatorMissing
      void this.stop('error')
    }
  }

  private onChunk(blob: Blob) {
    const run = this.run
    if (!run || blob.size === 0) return
    if (run.uploader) {
      run.uploader.enqueue(blob)
      return
    }
    run.parts.push(blob)
    this.update({ chunksProduced: run.parts.length, chunksAcked: run.parts.length })
  }

  private onUploader(run: Run, upload: UploaderState) {
    if (this.run !== run) return
    this.update({
      chunksProduced: upload.produced,
      chunksAcked: upload.acked,
      retries: upload.retries,
      backlogBytes: upload.backlogBytes,
      backlogChunks: upload.backlogChunks,
      behind: upload.behind,
    })
    if (this.state.value.phase !== 'recording') return
    // Uploading ended while still recording: stop capturing what can no longer be stored.
    if (upload.status === 'stopped') void this.stop('indicator')
    else if (upload.status === 'failed') {
      this.reportUpload(run, upload)
      void this.stop('error')
    }
  }

  private onRecorderError(error: unknown) {
    console.warn('blinq: MediaRecorder error', error instanceof Error ? error.name : 'error')
    if (this.run) this.run.stopMessage ??= MESSAGES.recorderError
    void this.stop('error')
  }

  private inCall(): boolean {
    const phase = this.ctx.phase.value
    return phase === 'inCall' || phase === 'reconnecting'
  }

  private update(patch: Partial<RecordingState>) {
    this.state.value = { ...this.state.value, ...patch }
    if (__BLINQ_TEST_HOOKS__) {
      const hooks = testHooks()
      if (hooks) {
        const s = this.state.value
        hooks.state.recording = {
          recordingId: s.recordingId,
          mime: s.mime,
          chunksProduced: s.chunksProduced,
          chunksAcked: s.chunksAcked,
          retries: s.retries,
          phase: s.phase,
          mode: s.mode,
          error: s.error,
          backlogBytes: s.backlogBytes,
          startedAt: s.startedAt,
        }
      }
    }
  }
}
