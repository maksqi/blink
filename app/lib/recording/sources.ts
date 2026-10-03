/**
 * What the recording may draw and mix (pure). docs/SECURITY.md §3.2, AGENT.md rule 2.
 *
 * - Remote media is used only from publications that are encrypted (`encryptionType !== NONE`), subscribed, not muted
 *   and that have a live track. Nothing overrides this: an unencrypted or unsubscribed publication is never drawn or
 *   mixed, whatever else asks for it.
 * - Remote audio must additionally come from call-core's encrypted-verified playback list
 *   (`AudioControl.remoteAudioTracks()`); a track is matched to its publication by `MediaStreamTrack.id`, and a track
 *   no publication claims is dropped.
 * - Local media (own camera after processors, own screen share, own processed mic) is the recorder's own plaintext.
 */

export type PublicationSource = 'camera' | 'screen_share' | 'microphone' | 'screen_share_audio' | 'unknown'
export type VideoSource = 'camera' | 'screen_share'

/** The parts of a MediaStreamTrack these rules look at. */
export interface TrackLike {
  id: string
  readyState?: MediaStreamTrackState
}

export interface RemotePublicationFacts<T extends TrackLike = TrackLike> {
  identity: string
  source: PublicationSource
  kind: 'audio' | 'video'
  /** `publication.isEncrypted` (encryption type is not NONE). */
  encrypted: boolean
  subscribed: boolean
  muted: boolean
  track: T | null
}

export interface LocalVideoFacts<T extends TrackLike = TrackLike> {
  identity: string
  source: VideoSource
  track: T | null
}

export interface VideoSourceRef<T extends TrackLike = TrackLike> {
  identity: string
  source: VideoSource
  track: T
  local: boolean
}

export interface AudioSourceRef<T extends TrackLike = TrackLike> {
  identity: string
  source: 'microphone' | 'screen_share_audio'
  track: T
}

export function sourceKey(identity: string, source: VideoSource): string {
  return `${identity}:${source}`
}

const live = (track: TrackLike | null): boolean => Boolean(track) && track!.readyState !== 'ended'

/** Whether a remote publication's media may be recorded at all. */
export function recordable(publication: RemotePublicationFacts): boolean {
  return publication.encrypted && publication.subscribed && !publication.muted && live(publication.track)
}

/** Video the compositor may draw, keyed by `identity:source`. */
export function drawableVideo<T extends TrackLike>(
  remote: readonly RemotePublicationFacts<T>[],
  local: readonly LocalVideoFacts<T>[] = [],
): Map<string, VideoSourceRef<T>> {
  const out = new Map<string, VideoSourceRef<T>>()
  for (const item of local) {
    if (!live(item.track)) continue
    out.set(sourceKey(item.identity, item.source), {
      identity: item.identity,
      source: item.source,
      track: item.track!,
      local: true,
    })
  }
  for (const publication of remote) {
    if (publication.kind !== 'video') continue
    if (publication.source !== 'camera' && publication.source !== 'screen_share') continue
    if (!recordable(publication)) continue
    const key = sourceKey(publication.identity, publication.source)
    if (out.has(key)) continue
    out.set(key, {
      identity: publication.identity,
      source: publication.source,
      track: publication.track!,
      local: false,
    })
  }
  return out
}

/**
 * Remote audio the mixer may use: tracks from the encrypted-verified playback list that belong to a recordable audio
 * publication, with the publisher's identity.
 */
export function mixableAudio<T extends TrackLike>(
  remote: readonly RemotePublicationFacts<T>[],
  verifiedTracks: readonly TrackLike[],
): AudioSourceRef<T>[] {
  const verified = new Set(verifiedTracks.filter((track) => live(track)).map((track) => track.id))
  const out: AudioSourceRef<T>[] = []
  const seen = new Set<string>()
  for (const publication of remote) {
    if (publication.kind !== 'audio') continue
    if (publication.source !== 'microphone' && publication.source !== 'screen_share_audio') continue
    if (!recordable(publication)) continue
    const id = publication.track!.id
    if (!verified.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push({ identity: publication.identity, source: publication.source, track: publication.track! })
  }
  return out
}
