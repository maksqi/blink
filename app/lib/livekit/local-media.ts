/**
 * Local camera and microphone for pre-join and the call. The tracks created for the pre-join preview are the ones
 * published on join (track reuse), so the device choice, the mic chain and any media-fx processor carry over.
 *
 * - Camera off = `mute()`: LiveKit stops the device (the camera light goes off) and reacquires it on `unmute()`, with
 *   the same processor, so a published camera keeps its trackSid through off/on and device switches.
 * - Mic off = `mute()` with the device kept open (`stopMicTrackOnMute: false`), so push to talk unmutes instantly.
 * - The mic runs through the MicChain (audio-context.ts) from the start; `setMicInsert`, `setMicGain` and
 *   `setMicProcessing` never replace the published track.
 */
import {
  createLocalAudioTrack,
  createLocalVideoTrack,
  type LocalAudioTrack,
  type LocalVideoTrack,
  type Track,
  type TrackProcessor,
} from 'livekit-client'
import { markRaw } from 'vue'
import type { MicInsert, MicProcessingConstraints } from '../contracts/call'
import { captureErrorOf, type CaptureError } from '../call/devices'
import { MicChain, sharedAudioContext } from './audio-context'
import { cameraPreset, type MediaLimits } from './presets'

export interface LocalMediaStatus {
  cameraOn: boolean
  micOn: boolean
  cameraError: CaptureError | null
  micError: CaptureError | null
  cameraBusy: boolean
  micBusy: boolean
  cameraDeviceId: string | null
  micDeviceId: string | null
}

export interface LocalMediaOptions {
  limits: MediaLimits
  onStatus: (status: LocalMediaStatus) => void
  /** A track object was created, replaced or restarted (previews re-attach, the session republishes if needed). */
  onTracks: () => void
}

export const DEFAULT_MIC_PROCESSING: MicProcessingConstraints = {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
}

export class LocalMedia {
  camera: LocalVideoTrack | null = null
  mic: LocalAudioTrack | null = null
  readonly chain: MicChain
  status: LocalMediaStatus = {
    cameraOn: false,
    micOn: false,
    cameraError: null,
    micError: null,
    cameraBusy: false,
    micBusy: false,
    cameraDeviceId: null,
    micDeviceId: null,
  }

  private cameraProcessor: TrackProcessor<Track.Kind.Video> | null = null
  private processing: MicProcessingConstraints = { ...DEFAULT_MIC_PROCESSING }
  private cameraQueue: Promise<unknown> = Promise.resolve()
  private micQueue: Promise<unknown> = Promise.resolve()
  private disposed = false

  constructor(private readonly options: LocalMediaOptions) {
    this.chain = markRaw(new MicChain(sharedAudioContext()))
    this.chain.onRebuilt = () => this.options.onTracks()
  }

  get audioContext(): AudioContext {
    return this.chain.audioContext
  }

  get micProcessing(): MicProcessingConstraints {
    return { ...this.processing }
  }

  /** Starts (or unmutes) the camera. */
  enableCamera(deviceId?: string): Promise<void> {
    return this.queueCamera(async () => {
      this.update({ cameraBusy: true })
      try {
        if (!this.camera) {
          this.camera = markRaw(
            await createLocalVideoTrack({
              ...(deviceId ? { deviceId } : {}),
              resolution: cameraPreset(this.options.limits).resolution,
            }),
          )
          this.options.onTracks()
        } else if (this.camera.isMuted) {
          if (deviceId) await this.camera.setDeviceId(deviceId)
          await this.camera.unmute()
          this.options.onTracks()
        }
        if (this.cameraProcessor && this.camera.getProcessor() !== this.cameraProcessor) {
          await this.camera.setProcessor(this.cameraProcessor)
        }
        this.update({ cameraOn: true, cameraError: null, cameraDeviceId: await this.deviceIdOf(this.camera) })
      } catch (error) {
        this.update({ cameraOn: false, cameraError: captureErrorOf(error) })
        throw error
      } finally {
        this.update({ cameraBusy: false })
      }
    })
  }

  /** Stops the camera device (the track object stays for reuse). */
  disableCamera(): Promise<void> {
    return this.queueCamera(async () => {
      if (this.camera && !this.camera.isMuted) await this.camera.mute()
      this.update({ cameraOn: false })
    })
  }

  /** Opens the microphone (if needed) and unmutes it. */
  enableMic(deviceId?: string): Promise<void> {
    return this.queueMic(async () => {
      await this.ensureMicInternal(deviceId)
      if (this.mic?.isMuted) await this.mic.unmute()
      this.update({ micOn: Boolean(this.mic) })
    })
  }

  /** Opens the microphone muted (push to talk and the level meter need the track). */
  ensureMic(deviceId?: string): Promise<void> {
    return this.queueMic(async () => {
      const created = await this.ensureMicInternal(deviceId)
      if (created && this.mic && !this.mic.isMuted) await this.mic.mute()
      this.update({ micOn: Boolean(this.mic && !this.mic.isMuted) })
    })
  }

  disableMic(): Promise<void> {
    return this.queueMic(async () => {
      if (this.mic && !this.mic.isMuted) await this.mic.mute()
      this.update({ micOn: false })
    })
  }

  switchCamera(deviceId: string): Promise<void> {
    return this.queueCamera(async () => {
      if (!this.camera) return
      this.update({ cameraBusy: true })
      try {
        await this.camera.setDeviceId(deviceId)
        this.update({ cameraDeviceId: this.camera.isMuted ? deviceId : await this.deviceIdOf(this.camera), cameraError: null })
        this.options.onTracks()
      } catch (error) {
        this.update({ cameraError: captureErrorOf(error) })
        throw error
      } finally {
        this.update({ cameraBusy: false })
      }
    })
  }

  switchMic(deviceId: string): Promise<void> {
    return this.queueMic(async () => {
      if (!this.mic) return
      this.update({ micBusy: true })
      try {
        // Muted mics restart on the next unmute (LiveKit's pending device change); restart now so the meter follows.
        await this.mic.restartTrack({ deviceId, ...this.processing })
        this.update({ micDeviceId: await this.deviceIdOf(this.mic) ?? deviceId, micError: null })
        this.options.onTracks()
      } catch (error) {
        this.update({ micError: captureErrorOf(error) })
        throw error
      } finally {
        this.update({ micBusy: false })
      }
    })
  }

  /** Attaches or replaces (null removes) the camera processor; kept on every later camera track. No republish. */
  setCameraProcessor(processor: TrackProcessor<Track.Kind.Video> | null): Promise<void> {
    return this.queueCamera(async () => {
      this.cameraProcessor = processor
      const camera = this.camera
      if (!camera) return
      if (processor) {
        if (camera.getProcessor() !== processor && !camera.isMuted) await camera.setProcessor(processor)
      } else if (camera.getProcessor()) {
        await camera.stopProcessor()
      }
      this.options.onTracks()
    })
  }

  setMicInsert(insert: MicInsert | null): Promise<void> {
    return this.queueMic(() => this.chain.setInsert(insert))
  }

  /** Re-acquires the mic with new browser processing; the chain keeps the published track (no republish). */
  setMicProcessing(constraints: MicProcessingConstraints): Promise<void> {
    return this.queueMic(async () => {
      this.processing = { ...constraints }
      if (!this.mic) return
      const deviceId = this.status.micDeviceId ?? await this.deviceIdOf(this.mic)
      await this.mic.restartTrack({ ...(deviceId ? { deviceId } : {}), ...this.processing })
      this.options.onTracks()
    })
  }

  setMicGain(gain: number): void {
    this.chain.setGain(gain)
  }

  /** Current camera MediaStreamTrack after processors, or null while off. */
  cameraTrack(): MediaStreamTrack | null {
    if (!this.camera || this.camera.isMuted) return null
    return this.camera.mediaStreamTrack
  }

  /** The processed mic track (what is published), or null. */
  micTrack(): MediaStreamTrack | null {
    return this.mic ? this.mic.mediaStreamTrack : null
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.camera?.stop()
    this.mic?.stop()
    void this.chain.destroy()
    this.camera = null
    this.mic = null
  }

  private async ensureMicInternal(deviceId?: string): Promise<boolean> {
    if (this.mic) return false
    this.update({ micBusy: true })
    try {
      const mic = await createLocalAudioTrack({ ...(deviceId ? { deviceId } : {}), ...this.processing })
      mic.setAudioContext(this.chain.audioContext)
      await mic.setProcessor(this.chain)
      this.mic = markRaw(mic)
      this.update({ micError: null, micDeviceId: await this.deviceIdOf(mic) })
      this.options.onTracks()
      return true
    } catch (error) {
      this.update({ micOn: false, micError: captureErrorOf(error) })
      throw error
    } finally {
      this.update({ micBusy: false })
    }
  }

  private async deviceIdOf(track: LocalVideoTrack | LocalAudioTrack): Promise<string | null> {
    try {
      return (await track.getDeviceId(false)) ?? null
    } catch {
      return null
    }
  }

  private update(patch: Partial<LocalMediaStatus>) {
    if (this.disposed) return
    this.status = { ...this.status, ...patch }
    this.options.onStatus(this.status)
  }

  private queueCamera<T>(run: () => Promise<T>): Promise<T> {
    const next = this.cameraQueue.then(run, run)
    this.cameraQueue = next.catch(() => undefined)
    return next
  }

  private queueMic<T>(run: () => Promise<T>): Promise<T> {
    const next = this.micQueue.then(run, run)
    this.micQueue = next.catch(() => undefined)
    return next
  }
}
