/**
 * Recording controller: one per call session (created by the recording feature's `setup`). It owns the capture
 * pipeline (compositor → canvas track, mixer → audio track, MediaRecorder) and either the uploader (server mode) or the
 * in-memory parts (local-only mode). docs/stages/08-recording.md, docs/ARCHITECTURE.md §6.5, docs/SECURITY.md §6.
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
import { RoomEvent, Track, type Room, type TrackPublication } from 'livekit-client'
import { shallowRef, type ShallowRef } from 'vue'
import type { StartRecordingResponse } from '#shared/schemas/recordings'
import type { CallContext, VideoDemand } from '../contracts/call'
import { testHooks } from '../contracts/test-hooks'
import type { FrameClock } from './clock'
import { Compositor, type SceneTile } from './compositor'
import { AUDIO_BITRATE, canvasSizeFor, VIDEO_BITRATES, type RecordingLayout, type RecordingResolution } from './layout'
import { localFileName, saveRecordingFile } from './local-file'
import { pickRecordingMime } from './mime'
import { buildMixSources, RecordingMixer } from './mixer'
import { ChunkRecorder } from './recorder'
import {
  drawableVideo,
  mixableAudio,
  sourceKey,
  type LocalVideoFacts,
  type PublicationSource,
  type RemotePublicationFacts,
} from './sources'
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
  /** Overrides the transport (tests). */
  transport?: (recordingId: string) => UploadTransport
}

/** Warn this long before the time limit. */
export const LIMIT_WARNING_MS = 5 * 60_000
/** Stop when the server's indicator has not shown up this long after the start (decision). */
export const INDICATOR_TIMEOUT_MS = 10_000
/** How often the mixer re-reads its sources (besides subscription events), in clock ticks. */
const MIX_RESYNC_TICKS = 15

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
  stoppedByServer: 'The server ended the recording. The part uploaded so far is kept.',
  uploadFailed: "The recording couldn't be uploaded completely. The part uploaded so far is kept.",
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

function sourceOf(publication: TrackPublication): PublicationSource {
  switch (publication.source) {
    case Track.Source.Camera:
      return 'camera'
    case Track.Source.ScreenShare:
      return 'screen_share'
    case Track.Source.Microphone:
      return 'microphone'
    case Track.Source.ScreenShareAudio:
      return 'screen_share_audio'
    default:
      return 'unknown'
  }
}

function errorText(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown } | null)?.message
  const named = (error as { name?: unknown } | null)?.name
  // ApiError carries an English message for the UI; anything else gets the generic text.
  return named === 'ApiError' && typeof message === 'string' && message ? message : fallback
}

interface Pipeline {
  compositor: Compositor
  mixer: RecordingMixer
  recorder: ChunkRecorder
  canvasSize: { width: number; height: number }
  removeDemand: (() => void) | null
  detachRoom: () => void
  ticks: number
}

interface Run {
  mode: RecordingMode
  pipeline: Pipeline
  recordingId: string | null
  startedAtPerf: number
  uploader: ChunkUploader | null
  parts: Blob[]
  seenIndicator: string | null
  warned: boolean
  /** Error message to show when the run ends. */
  stopMessage: string | null
}

export class RecordingController {
  readonly state: ShallowRef<RecordingState> = shallowRef({ ...IDLE })
  readonly config: ShallowRef<RecordingConfig | null> = shallowRef(null)

  private run: Run | null = null
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

  /** The recorder side is busy (recording, stopping or uploading): leaving the page loses data. */
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

    const canvasSize = canvasSizeFor(config.maxResolution)
    let pipeline: Pipeline
    try {
      pipeline = this.createPipeline(mime, canvasSize, config.maxResolution)
    } catch (error) {
      console.warn('blinq: recording pipeline failed', error instanceof Error ? error.name : 'error')
      return this.failStart(MESSAGES.pipeline)
    }

    this.pendingStop = null
    this.update({ ...IDLE, phase: 'starting', mode, mime })
    void pipeline.mixer.resume()

    let response: StartRecordingResponse
    try {
      response = await this.ctx.callApi<StartRecordingResponse>('/recording/start', {
        method: 'POST',
        body: { mode, mimeType: mime, width: canvasSize.width, height: canvasSize.height },
      })
    } catch (error) {
      this.disposePipeline(pipeline)
      return this.failStart(errorText(error, MESSAGES.startFailed))
    }

    const startedAt = this.now()
    const run: Run = {
      mode,
      pipeline,
      recordingId: response.recordingId,
      startedAtPerf: startedAt,
      uploader: null,
      parts: [],
      seenIndicator: this.ctx.roomState.value?.recording?.startedAt ?? null,
      warned: false,
      stopMessage: null,
    }
    this.run = run
    if (mode === 'server') {
      const transport =
        this.deps.transport?.(response.recordingId) ?? recordingTransport(response.recordingId, this.deps.fetch)
      run.uploader = new ChunkUploader({ transport, onChange: (state) => this.onUploader(run, state) })
    }

    // The call ended or the page went away while the start request ran: the server cleans up (recorder left).
    if (this.disposed || this.pendingStop === 'phase' || this.pendingStop === 'dispose' || !this.inCall()) {
      this.run = null
      this.disposePipeline(pipeline)
      run.uploader?.abort()
      this.update({ ...IDLE })
      return false
    }

    try {
      pipeline.recorder.start()
    } catch (error) {
      console.warn('blinq: MediaRecorder did not start', error instanceof Error ? error.name : 'error')
      run.stopMessage = MESSAGES.pipeline
      this.update({ phase: 'recording', recordingId: response.recordingId, startedAt })
      await this.stop('error')
      return false
    }
    this.update({
      phase: 'recording',
      recordingId: response.recordingId,
      mime,
      startedAt,
      maxDurationMs: response.maxDurationMs,
    })
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
    const phase = this.state.value.phase
    if (phase === 'starting') {
      this.pendingStop ??= reason
      return Promise.resolve()
    }
    if (phase !== 'recording' || !this.run) return this.stopping ?? Promise.resolve()
    this.stopping = this.finishRun(this.run, reason).finally(() => {
      this.stopping = null
    })
    return this.stopping
  }

  private async finishRun(run: Run, reason: StopReason): Promise<void> {
    try {
      this.update({ phase: 'stopping' })
      // 1. Stop capturing: the final chunk is delivered before this resolves.
      await run.pipeline.recorder.stop()
      const durationMs = Math.max(0, this.now() - run.startedAtPerf)
      this.disposePipeline(run.pipeline)

      // 2. Indicator off for everyone. Not for 'indicator' (it is off or the server finalized it already), nor after
      //    the call ended or the page unmounted (no longer a participant: complete or the server's finalize does it).
      if ((reason === 'user' || reason === 'limit' || reason === 'error') && this.inCall()) {
        await this.ctx.callApi('/recording/stop', { method: 'POST' }).catch(() => undefined)
      }

      // 3. Upload the rest and complete, or save the file locally (best effort after an unmount: the page lives on).
      if (run.mode === 'server' && run.uploader) {
        this.update({ phase: 'finishing' })
        const result = await run.uploader.finish(durationMs)
        this.reportUpload(run, result)
      } else if (run.mode === 'local') {
        this.saveLocal(run)
      }
    } finally {
      if (run.stopMessage) this.deps.notify.error(run.stopMessage)
      if (this.run === run) this.run = null
      this.update({ ...IDLE, error: run.stopMessage })
    }
  }

  private reportUpload(run: Run, result: UploaderState) {
    if (result.status === 'completed') {
      if (!run.stopMessage) this.deps.notify.success(MESSAGES.savedServer)
    } else if (result.status === 'stopped') {
      if (!run.stopMessage) this.deps.notify.info(MESSAGES.stoppedByServer)
    } else if (!run.stopMessage) {
      run.stopMessage =
        result.errorCode === 'RECORDING_QUOTA_EXCEEDED'
          ? 'Your recording storage quota is full. The part uploaded so far is kept.'
          : MESSAGES.uploadFailed
    }
  }

  private saveLocal(run: Run) {
    if (!this.doc || run.parts.length === 0) return
    const mime = this.state.value.mime ?? 'video/webm'
    const name = localFileName(this.ctx.slug.value ?? 'meeting', new Date(run.startedAtPerf), mime)
    try {
      saveRecordingFile(run.parts, mime, name, this.doc)
      if (!run.stopMessage) this.deps.notify.success(MESSAGES.savedLocal)
    } catch (error) {
      console.warn('blinq: saving the recording failed', error instanceof Error ? error.name : 'error')
      run.stopMessage ??= "The recording couldn't be saved on this device."
    }
    run.parts = []
  }

  // ---- Events from the call ------------------------------------------------------------------------------------------

  /** Room metadata changed: stop when our indicator turned off or became someone else's. */
  onIndicator(recording: { startedAt: string } | null): void {
    const run = this.run
    // While starting, the 201 handler reads the current metadata itself (it can arrive before the response).
    if (!run || this.state.value.phase !== 'recording') return
    if (recording) {
      if (run.seenIndicator === null) run.seenIndicator = recording.startedAt
      else if (run.seenIndicator !== recording.startedAt) void this.stop('indicator')
    } else if (run.seenIndicator !== null) {
      void this.stop('indicator')
    }
  }

  /** The call phase changed: anything but in-call (or a short reconnect) ends the recording. */
  onPhase(phase: CallContext['phase']['value']): void {
    if (phase === 'inCall' || phase === 'reconnecting') return
    void this.stop('phase')
  }

  /** Stops the recording someone else in the meeting is making (any moderator with an account may). */
  async stopOthers(): Promise<boolean> {
    try {
      await this.ctx.callApi('/recording/stop', { method: 'POST' })
      return true
    } catch (error) {
      this.deps.notify.error(errorText(error, "The recording didn't stop. Try again."))
      return false
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const run = this.run
    if (run) {
      void this.stop('dispose')
    } else if (this.state.value.phase === 'starting') {
      this.pendingStop = 'dispose'
    }
  }

  // ---- Pipeline ------------------------------------------------------------------------------------------------------

  private createPipeline(
    mime: string,
    canvasSize: { width: number; height: number },
    resolution: RecordingResolution,
  ): Pipeline {
    const room = this.ctx.room.value
    if (!room) throw new Error('Not connected')
    const mixer = new RecordingMixer({
      onError: (error) =>
        console.warn('blinq: a recording audio source failed', error instanceof Error ? error.name : 'error'),
    })
    let compositor: Compositor | null = null
    try {
      const pipeline = {} as Pipeline
      compositor = new Compositor({
        size: canvasSize,
        clock: this.deps.createClock(),
        document: this.doc,
        scene: () => this.scene(room),
        onLayout: (layout, tiles) => this.onLayout(pipeline, layout, tiles),
        onTick: () => this.onTick(pipeline),
      })
      const audio = mixer.track
      const tracks = audio ? [compositor.track, audio] : [compositor.track]
      const recorder = new ChunkRecorder({
        stream: new MediaStream(tracks),
        mimeType: mime,
        videoBitsPerSecond: VIDEO_BITRATES[resolution],
        audioBitsPerSecond: AUDIO_BITRATE,
        onChunk: (blob) => this.onChunk(blob),
        onError: (error) => this.onRecorderError(error),
      })
      Object.assign(pipeline, {
        compositor,
        mixer,
        recorder,
        canvasSize,
        removeDemand: null,
        detachRoom: this.watchRoom(room, () => this.syncMix(room, mixer)),
        ticks: 0,
      } satisfies Pipeline)
      this.syncMix(room, mixer)
      compositor.start()
      return pipeline
    } catch (error) {
      compositor?.stop()
      mixer.dispose()
      throw error
    }
  }

  private disposePipeline(pipeline: Pipeline) {
    pipeline.detachRoom()
    pipeline.removeDemand?.()
    pipeline.removeDemand = null
    pipeline.compositor.stop()
    pipeline.mixer.dispose()
  }

  private watchRoom(room: Room, resync: () => void): () => void {
    const events = [
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.ParticipantAttributesChanged,
      RoomEvent.LocalTrackPublished,
      RoomEvent.ParticipantEncryptionStatusChanged,
    ] as const
    // Let call-core's own handlers (audio elements, views) run first.
    const handler = () => queueMicrotask(resync)
    for (const event of events) room.on(event, handler)
    return () => {
      for (const event of events) room.off(event, handler)
    }
  }

  private remoteFacts(room: Room): RemotePublicationFacts<MediaStreamTrack>[] {
    const facts: RemotePublicationFacts<MediaStreamTrack>[] = []
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        facts.push({
          identity: participant.identity,
          source: sourceOf(publication),
          kind: publication.kind === Track.Kind.Audio ? 'audio' : 'video',
          encrypted: publication.isEncrypted,
          subscribed: publication.isSubscribed,
          muted: publication.isMuted,
          track: publication.track?.mediaStreamTrack ?? null,
        })
      }
    }
    return facts
  }

  private localScreenTrack(room: Room): MediaStreamTrack | null {
    const publication = room.localParticipant.getTrackPublication(Track.Source.ScreenShare)
    if (!publication || publication.isMuted) return null
    return publication.track?.mediaStreamTrack ?? null
  }

  /** Everyone's camera tile (video or initials) in call order, then every drawable screen share. */
  private scene(room: Room): SceneTile[] {
    const participants = this.ctx.participants.value
    const self = this.ctx.self.value
    const local: LocalVideoFacts<MediaStreamTrack>[] = self
      ? [
          { identity: self.identity, source: 'camera', track: this.ctx.media.cameraTrack() },
          { identity: self.identity, source: 'screen_share', track: this.localScreenTrack(room) },
        ]
      : []
    const video = drawableVideo(this.remoteFacts(room), local)
    const cameras: SceneTile[] = []
    const screens: SceneTile[] = []
    for (const participant of participants) {
      const cameraKey = sourceKey(participant.identity, 'camera')
      cameras.push({
        key: cameraKey,
        kind: 'camera',
        identity: participant.identity,
        name: participant.name,
        micMuted: !participant.micEnabled,
        track: video.get(cameraKey)?.track ?? null,
      })
      const screenKey = sourceKey(participant.identity, 'screen_share')
      const screen = video.get(screenKey)
      if (screen) {
        screens.push({
          key: screenKey,
          kind: 'screen',
          identity: participant.identity,
          name: participant.name,
          micMuted: false,
          track: screen.track,
        })
      }
    }
    return [...cameras, ...screens]
  }

  /** Keeps every remote tile's video flowing at the size it is drawn (screen shares at canvas size). */
  private onLayout(pipeline: Pipeline, layout: RecordingLayout, tiles: SceneTile[]) {
    const selfIdentity = this.ctx.self.value?.identity
    const byKey = new Map(tiles.map((tile) => [tile.key, tile]))
    const demands: VideoDemand[] = []
    for (const rect of layout.tiles) {
      const tile = byKey.get(rect.key)
      if (!tile || tile.identity === selfIdentity) continue
      // Every remote camera tile has a demand, also while it shows initials, so a camera turned on appears at once.
      demands.push(
        tile.kind === 'screen'
          ? { identity: tile.identity, source: 'screen_share', ...pipeline.canvasSize }
          : { identity: tile.identity, source: 'camera', width: rect.width, height: rect.height },
      )
    }
    pipeline.removeDemand = this.ctx.subscriptions.setDemand('recording', demands)
  }

  private syncMix(room: Room, mixer: RecordingMixer) {
    const views = new Map(this.ctx.participants.value.map((view) => [view.identity, view]))
    const remote = mixableAudio(this.remoteFacts(room), this.ctx.audio.remoteAudioTracks())
    mixer.sync(buildMixSources(remote, (identity) => views.get(identity)?.volumeForEveryone, this.ctx.media.micTrack()))
  }

  private onTick(pipeline: Pipeline) {
    pipeline.ticks++
    const room = this.ctx.room.value
    if (room && pipeline.ticks % MIX_RESYNC_TICKS === 0) this.syncMix(room, pipeline.mixer)
    const run = this.run
    const state = this.state.value
    if (!run || run.pipeline !== pipeline || state.phase !== 'recording') return
    const elapsed = this.now() - run.startedAtPerf
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
      run.stopMessage = MESSAGES.indicatorMissing
      void this.stop('error')
    }
  }

  private onChunk(blob: Blob) {
    const run = this.run
    if (!run) return
    if (run.mode === 'local') {
      run.parts.push(blob)
      this.update({ chunksProduced: this.state.value.chunksProduced + 1, chunksAcked: run.parts.length })
      return
    }
    run.uploader?.enqueue(blob)
  }

  private onUploader(run: Run, upload: UploaderState) {
    if (this.run !== run && this.state.value.recordingId !== run.recordingId) return
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
