/**
 * The shared 48 kHz AudioContext and the microphone chain (docs/ARCHITECTURE.md §7):
 *
 *   mic track → MediaStreamAudioSource → [MicInsert, e.g. RNNoise] → GainNode (own mic gain) → destination → published
 *                                                                              └→ AnalyserNode (level meter)
 *
 * The chain is a LiveKit audio `TrackProcessor` set on the LocalAudioTrack (after `setAudioContext`). Its output track
 * never changes, so inserting or removing a stage, changing the gain or switching the microphone never republishes:
 * the mic publication keeps its trackSid. On a device switch LiveKit calls `restart()` with the new raw track and the
 * chain re-wires its source in front of the same insert and gain.
 *
 * The recording mixer uses its own AudioContext (Stage 08).
 */
import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client'
import type { MicInsert } from '../contracts/call'

let shared: AudioContext | null = null
let gestureHooked = false

/**
 * One AudioContext for the mic chain, the pre-join meter and media-fx. 48 kHz when the browser allows it (RNNoise
 * needs 48 kHz; media-fx checks `sampleRate`).
 */
export function sharedAudioContext(): AudioContext {
  if (!shared || shared.state === 'closed') {
    try {
      shared = new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' })
    } catch {
      shared = new AudioContext({ latencyHint: 'interactive' })
    }
    hookGestureResume()
  }
  return shared
}

/** Firefox cannot connect a mic stream into a context with a different rate; fall back to the device rate. */
function replaceSharedWithDeviceRate(): AudioContext {
  const previous = shared
  shared = new AudioContext({ latencyHint: 'interactive' })
  void previous?.close().catch(() => undefined)
  return shared
}

/** Contexts start suspended until a user gesture; resume on the first one (and on Join). */
export async function resumeSharedAudioContext(): Promise<void> {
  if (shared && shared.state === 'suspended') await shared.resume().catch(() => undefined)
}

function hookGestureResume() {
  if (gestureHooked || typeof document === 'undefined') return
  gestureHooked = true
  const resume = () => void resumeSharedAudioContext()
  for (const type of ['pointerdown', 'keydown', 'touchend'])
    document.addEventListener(type, resume, { capture: true, passive: true })
}

export class MicChain implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'blinq-mic-chain'
  processedTrack?: MediaStreamTrack

  private context: AudioContext
  private source: MediaStreamAudioSourceNode | null = null
  private insert: MicInsert | null = null
  private insertOutput: AudioNode | null = null
  private gain!: GainNode
  private analyser!: AnalyserNode
  private destination!: MediaStreamAudioDestinationNode
  private gainValue = 1
  private rawTrack: MediaStreamTrack | null = null
  private readonly samples = new Float32Array(1024)
  private rebuilt: (() => void) | null = null

  constructor(context: AudioContext = sharedAudioContext()) {
    this.context = context
    this.buildOutput()
  }

  /** Called when the chain had to move to another context (see `onContextReplaced`). */
  set onRebuilt(callback: (() => void) | null) {
    this.rebuilt = callback
  }

  get audioContext(): AudioContext {
    return this.context
  }

  async init(options: AudioProcessorOptions): Promise<void> {
    await this.connectSource(options.track)
  }

  async restart(options: AudioProcessorOptions): Promise<void> {
    await this.connectSource(options.track)
  }

  async destroy(): Promise<void> {
    this.source?.disconnect()
    this.insertOutput?.disconnect()
    this.insert?.dispose()
    this.insert = null
    this.insertOutput = null
    this.source = null
    this.gain.disconnect()
    this.analyser.disconnect()
  }

  /** Own mic gain, 0..2 (clamped by the AudioEngine). */
  setGain(value: number): void {
    this.gainValue = value
    this.gain.gain.setTargetAtTime(value, this.context.currentTime, 0.015)
  }

  get gainLevel(): number {
    return this.gainValue
  }

  /** Puts `insert` between the source and the gain (null removes it). The previous insert is disposed. */
  async setInsert(insert: MicInsert | null): Promise<void> {
    const previous = this.insert
    if (previous === insert) return
    this.unwire()
    this.insert = insert
    try {
      await this.wire()
    } catch (error) {
      this.unwire()
      this.insert = null
      await this.wire()
      throw error
    } finally {
      if (previous && previous !== insert) previous.dispose()
    }
  }

  /** Current level after the gain, 0..1 (RMS mapped from -60..0 dBFS), for the level meter. */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.samples)
    let sum = 0
    for (const sample of this.samples) sum += sample * sample
    const rms = Math.sqrt(sum / this.samples.length)
    if (rms <= 0) return 0
    const db = 20 * Math.log10(rms)
    return Math.min(1, Math.max(0, (db + 60) / 60))
  }

  private buildOutput() {
    this.gain = this.context.createGain()
    this.gain.gain.value = this.gainValue
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = 2048
    this.destination = this.context.createMediaStreamDestination()
    this.gain.connect(this.destination)
    this.gain.connect(this.analyser)
    this.processedTrack = this.destination.stream.getAudioTracks()[0]
  }

  private async connectSource(track: MediaStreamTrack): Promise<void> {
    this.rawTrack = track
    this.unwire()
    try {
      this.source = this.context.createMediaStreamSource(new MediaStream([track]))
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'NotSupportedError') throw error
      // Sample-rate mismatch (Firefox): move the whole chain to a device-rate context.
      this.context = replaceSharedWithDeviceRate()
      this.buildOutput()
      this.source = this.context.createMediaStreamSource(new MediaStream([track]))
      this.rebuilt?.()
    }
    await this.wire()
  }

  private unwire() {
    this.source?.disconnect()
    this.insertOutput?.disconnect()
    this.insertOutput = null
  }

  private async wire(): Promise<void> {
    if (!this.source) return
    if (this.insert) {
      this.insertOutput = await this.insert.connect(this.context, this.source)
      this.insertOutput.connect(this.gain)
    } else {
      this.source.connect(this.gain)
    }
  }

  /** The raw capture track (before the chain). */
  get inputTrack(): MediaStreamTrack | null {
    return this.rawTrack
  }
}
