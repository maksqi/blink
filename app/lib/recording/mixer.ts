/**
 * Recording audio mix: its own 48 kHz AudioContext (never call-core's mic chain) → one
 * `MediaStreamAudioDestinationNode` whose track goes into the MediaRecorder.
 *
 * - Sources come from `sources.ts` (encrypted-verified remote tracks) plus the recorder's processed mic. Each source
 *   is `MediaStreamAudioSourceNode → GainNode → destination`; remote gains are the host volume for everyone (`vol`) /
 *   100. The recorder's own playback volume (`setLocalVolume`) is a listening preference and is ignored.
 * - `sync()` is idempotent: new sources are connected, gone ones disconnected, gains updated.
 * - Never touches `<audio>` elements: call-core keeps them attached (Chrome bug 40094084, remote WebRTC audio is
 *   silent in WebAudio unless an element also plays it).
 */

export const MIX_SAMPLE_RATE = 48_000

export interface MixSource {
  /** Stable id (the MediaStreamTrack id). */
  id: string
  track: MediaStreamTrack
  /** Linear gain 0..1. */
  gain: number
}

/** The AudioContext surface the mixer uses (structural, so tests can fake it). */
export interface MixerAudioContext {
  readonly state: AudioContextState
  createMediaStreamSource(stream: MediaStream): AudioNode
  createGain(): GainNode
  createMediaStreamDestination(): MediaStreamAudioDestinationNode
  resume(): Promise<void>
  close(): Promise<void>
}

export interface MixerOptions {
  createContext?: () => MixerAudioContext
  createStream?: (tracks: MediaStreamTrack[]) => MediaStream
  onError?: (error: unknown) => void
}

/** Host volume for everyone (0..100, the `vol` attribute) as a linear gain 0..1. */
export function hostGain(volumeForEveryone: number | null | undefined): number {
  if (typeof volumeForEveryone !== 'number' || !Number.isFinite(volumeForEveryone)) return 1
  return Math.min(Math.max(volumeForEveryone, 0), 100) / 100
}

/**
 * The mix: every recordable remote track at the publisher's host volume (`vol` / 100), plus the recorder's processed
 * mic at unity (its own mic gain is already applied in that track). Local playback volumes play no part.
 */
export function buildMixSources(
  remote: readonly { identity: string; track: MediaStreamTrack }[],
  hostVolume: (identity: string) => number | null | undefined,
  localMic: MediaStreamTrack | null,
): MixSource[] {
  const out: MixSource[] = remote.map((source) => ({
    id: source.track.id,
    track: source.track,
    gain: hostGain(hostVolume(source.identity)),
  }))
  if (localMic && localMic.readyState !== 'ended' && !out.some((source) => source.id === localMic.id)) {
    out.push({ id: localMic.id, track: localMic, gain: 1 })
  }
  return out
}

interface Connected {
  track: MediaStreamTrack
  source: AudioNode
  gain: GainNode
}

export class RecordingMixer {
  readonly context: MixerAudioContext
  private readonly destination: MediaStreamAudioDestinationNode
  private readonly connected = new Map<string, Connected>()
  private readonly createStream: (tracks: MediaStreamTrack[]) => MediaStream
  private disposed = false

  constructor(private readonly options: MixerOptions = {}) {
    this.context =
      options.createContext?.() ??
      (new AudioContext({ sampleRate: MIX_SAMPLE_RATE, latencyHint: 'playback' }) as MixerAudioContext)
    this.createStream = options.createStream ?? ((tracks) => new MediaStream(tracks))
    this.destination = this.context.createMediaStreamDestination()
  }

  /** The mixed audio track for the MediaRecorder. */
  get track(): MediaStreamTrack | null {
    return this.destination.stream.getAudioTracks()[0] ?? null
  }

  /** Ids of the sources currently mixed (tests and diagnostics). */
  get sourceIds(): string[] {
    return [...this.connected.keys()]
  }

  gainOf(id: string): number | null {
    return this.connected.get(id)?.gain.gain.value ?? null
  }

  sync(sources: readonly MixSource[]): void {
    if (this.disposed) return
    const wanted = new Map(sources.map((source) => [source.id, source]))
    for (const [id, entry] of this.connected) {
      const next = wanted.get(id)
      if (!next || next.track !== entry.track || entry.track.readyState === 'ended') this.disconnect(id)
    }
    for (const source of sources) {
      const gain = Math.min(Math.max(Number.isFinite(source.gain) ? source.gain : 1, 0), 1)
      const existing = this.connected.get(source.id)
      if (existing) {
        if (existing.gain.gain.value !== gain) existing.gain.gain.value = gain
        continue
      }
      if (source.track.readyState === 'ended') continue
      try {
        const node = this.context.createMediaStreamSource(this.createStream([source.track]))
        const gainNode = this.context.createGain()
        gainNode.gain.value = gain
        node.connect(gainNode)
        gainNode.connect(this.destination)
        this.connected.set(source.id, { track: source.track, source: node, gain: gainNode })
      } catch (error) {
        // One unusable source (for example a sample-rate mismatch in Firefox) must not stop the recording.
        this.options.onError?.(error)
      }
    }
  }

  /** Starts the context if the browser created it suspended. */
  async resume(): Promise<void> {
    if (this.disposed || this.context.state !== 'suspended') return
    await this.context.resume().catch(() => undefined)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const id of [...this.connected.keys()]) this.disconnect(id)
    for (const track of this.destination.stream.getTracks()) track.stop()
    void this.context.close().catch(() => undefined)
  }

  private disconnect(id: string) {
    const entry = this.connected.get(id)
    if (!entry) return
    this.connected.delete(id)
    try {
      entry.source.disconnect()
      entry.gain.disconnect()
    } catch {
      // Already disconnected.
    }
  }
}
