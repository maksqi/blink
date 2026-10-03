/**
 * Remote audio playback (`AudioControl`). docs/ARCHITECTURE.md §7.
 *
 * - One `<audio>` element per subscribed remote audio track. Elements stay attached for the whole subscription, even
 *   while the recording mixer taps the same track: Chrome plays remote WebRTC audio into WebAudio only while an
 *   element also plays it (Chrome bug 40094084).
 * - Element volume = local volume (0..1, set in the tile menu) × host volume for everyone (`vol` attribute) / 100.
 * - Only tracks of encrypted publications from participants that are not blocked are accepted (the subscription policy
 *   never subscribes others; this is the second check), so `remoteAudioTracks()` is safe for the recording mixer.
 *
 * The session wires LiveKit events to `addTrack` / `removeTrack`; this module only needs structural types, which keeps
 * the volume math unit-testable in Node.
 */
import type { AudioControl } from '../contracts/call'

export interface AttachableAudioTrack {
  /** LiveKit track sid. */
  sid?: string
  mediaStreamTrack: MediaStreamTrack
  attach(element: HTMLMediaElement): HTMLMediaElement
  detach(element: HTMLMediaElement): HTMLMediaElement
}

export type AudioSource = 'microphone' | 'screen_share_audio'

export interface AudioEngineOptions {
  createElement: () => HTMLAudioElement
  /** Hidden element that holds the audio elements (created lazily by the caller). */
  container: () => HTMLElement
  /** Host volume for everyone, 0..100 (`ParticipantView.volumeForEveryone`). */
  hostVolume: (identity: string) => number
  /** Own mic gain (the mic chain in audio-context.ts). */
  setMicGain: (gain: number) => void
  /** The participant is blocked for the rest of the call (an unencrypted publication); their audio never plays. */
  blocked?: (identity: string) => boolean
  onChange?: () => void
}

interface Entry {
  identity: string
  source: AudioSource
  track: AttachableAudioTrack
  element: HTMLAudioElement
}

export const VOLUME_ATTRIBUTE_DEFAULT = 100

/** Parses the server-set `vol` attribute ("0".."100"); anything else means 100. */
export function parseVolumeAttribute(value: string | undefined | null): number {
  if (value === undefined || value === null || !/^(100|[1-9]?\d)$/.test(value)) return VOLUME_ATTRIBUTE_DEFAULT
  return Number(value)
}

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(Math.max(value, min), max) : min

/** Playback volume of one element: local 0..1 × host 0..100 / 100, clamped to 0..1. */
export function effectiveVolume(localVolume: number, hostVolume: number): number {
  return clamp(localVolume, 0, 1) * (clamp(hostVolume, 0, 100) / 100)
}

/** Own mic gain range: 0 (silent) .. 2 (+6 dB); 1 leaves the signal unchanged. */
export function clampMicGain(gain: number): number {
  return Number.isFinite(gain) ? clamp(gain, 0, 2) : 1
}

export interface AudioSnapshot {
  [identity: string]: { localVolume: number; hostVolume: number; elementVolume: number; tracks: number }
}

export class AudioEngine implements AudioControl {
  private readonly entries = new Map<string, Entry>()
  private readonly localVolumes = new Map<string, number>()
  private sinkId: string | null = null

  constructor(private readonly options: AudioEngineOptions) {}

  /** Starts playback of an encrypted remote track. Unencrypted tracks are refused. */
  addTrack(identity: string, source: AudioSource, track: AttachableAudioTrack, encrypted: boolean): void {
    if (!encrypted || this.options.blocked?.(identity)) return
    const key = track.sid ?? track.mediaStreamTrack.id
    const existing = this.entries.get(key)
    if (existing?.track === track) return
    if (existing) this.removeTrack(key)

    const element = this.options.createElement()
    element.autoplay = true
    element.setAttribute('playsinline', '')
    element.dataset.identity = identity
    element.dataset.source = source
    this.options.container().append(element)
    track.attach(element)
    this.entries.set(key, { identity, source, track, element })
    this.applyVolume(this.entries.get(key)!)
    if (this.sinkId) void this.applySink(element, this.sinkId)
    this.options.onChange?.()
  }

  removeTrack(trackSid: string): void {
    const entry = this.entries.get(trackSid)
    if (!entry) return
    entry.track.detach(entry.element)
    entry.element.srcObject = null
    entry.element.remove()
    this.entries.delete(trackSid)
    this.options.onChange?.()
  }

  /** Stops every track of one participant (they were blocked). */
  removeIdentity(identity: string): void {
    for (const [key, entry] of [...this.entries]) if (entry.identity === identity) this.removeTrack(key)
  }

  /** Re-applies volumes after a host volume (`vol`) change. */
  refreshVolumes(): void {
    for (const entry of this.entries.values()) this.applyVolume(entry)
  }

  setLocalVolume(identity: string, volume: number): void {
    this.localVolumes.set(identity, clamp(volume, 0, 1))
    for (const entry of this.entries.values()) if (entry.identity === identity) this.applyVolume(entry)
    this.options.onChange?.()
  }

  getLocalVolume(identity: string): number {
    return this.localVolumes.get(identity) ?? 1
  }

  setMicGain(gain: number): void {
    this.options.setMicGain(clampMicGain(gain))
    this.options.onChange?.()
  }

  remoteAudioTracks(): MediaStreamTrack[] {
    return [...this.entries.values()]
      .filter((entry) => !this.options.blocked?.(entry.identity))
      .map((entry) => entry.track.mediaStreamTrack)
      .filter((track) => track.readyState === 'live')
  }

  /** Speaker selection (only offered where `supportsAudioOutputSelection()`). */
  async setOutputDevice(deviceId: string): Promise<void> {
    this.sinkId = deviceId
    await Promise.all([...this.entries.values()].map((entry) => this.applySink(entry.element, deviceId)))
  }

  /** Starts elements that autoplay refused (called from a user gesture). */
  async resume(): Promise<void> {
    await Promise.all([...this.entries.values()].map((entry) => entry.element.play().catch(() => undefined)))
  }

  snapshot(): AudioSnapshot {
    const out: AudioSnapshot = {}
    for (const entry of this.entries.values()) {
      const current = out[entry.identity]
      out[entry.identity] = {
        localVolume: this.getLocalVolume(entry.identity),
        hostVolume: this.options.hostVolume(entry.identity),
        elementVolume: entry.element.volume,
        tracks: (current?.tracks ?? 0) + 1,
      }
    }
    return out
  }

  dispose(): void {
    for (const key of [...this.entries.keys()]) this.removeTrack(key)
    this.localVolumes.clear()
  }

  private applyVolume(entry: Entry): void {
    entry.element.volume = effectiveVolume(this.getLocalVolume(entry.identity), this.options.hostVolume(entry.identity))
  }

  private async applySink(element: HTMLAudioElement, deviceId: string): Promise<void> {
    const withSink = element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
    if (typeof withSink.setSinkId !== 'function') return
    try {
      await withSink.setSinkId(deviceId)
    } catch {
      // The device vanished or the browser refused; playback continues on the current output.
    }
  }
}
