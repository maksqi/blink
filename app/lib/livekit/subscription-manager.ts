/**
 * Thin applier for the subscription policy (subscription-policy.ts): collects the inputs from the Room, the rendered
 * tiles and the feature demands, and applies the difference with `setSubscribed`, `setEnabled` and
 * `setVideoDimensions`. Implements `SubscriptionControl` for features (recording uses `setDemand`).
 *
 * It also owns the call's sticky block list (docs/SECURITY.md §3.2, F-015): a remote participant who ever had an
 * unencrypted publication, or whose encryption status livekit-client reports as off, stays blocked for the rest of the
 * call, even after that publication is gone, because the SDK's per-participant decrypt flag may still be off.
 */
import {
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant,
  type RemoteTrackPublication,
  type Room,
} from 'livekit-client'
import type { CallEventBus, SubscriptionControl, VideoDemand } from '../contracts/call'
import {
  computeSubscriptions,
  type PolicyPublication,
  type PublicationSource,
  type SubscriptionDecision,
  type SubscriptionPlan,
  type TileRequest,
} from './subscription-policy'

export interface SubscriptionManagerOptions {
  room: Room
  events: CallEventBus
  /** This client's own E2EE state. */
  localEncrypted: () => boolean
  /** Called after every application (store and test hooks). */
  onPlan?: (plan: SubscriptionPlan) => void
  /** A participant was blocked for the rest of the call (stop their audio, drop their tiles). Called once each. */
  onBlocked?: (identity: string) => void
  /** Coalescing delay for bursts of changes (resize, many publications at join). */
  delayMs?: number
}

export function sourceName(source: Track.Source): PublicationSource {
  switch (source) {
    case Track.Source.Camera:
      return 'camera'
    case Track.Source.Microphone:
      return 'microphone'
    case Track.Source.ScreenShare:
      return 'screen_share'
    case Track.Source.ScreenShareAudio:
      return 'screen_share_audio'
    default:
      return 'unknown'
  }
}

interface Applied {
  width: number
  height: number
  track: unknown
}

export class SubscriptionManager implements SubscriptionControl {
  plan: SubscriptionPlan = { decisions: [], blockedIdentities: [] }

  private tiles: TileRequest[] = []
  private readonly demands = new Map<string, VideoDemand[]>()
  private readonly applied = new Map<string, Applied>()
  private readonly untrusted = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly cleanups: Array<() => void> = []
  private started = false
  private disposed = false

  constructor(private readonly options: SubscriptionManagerOptions) {
    // Listens from construction: the SDK can report a remote participant's encryption as off while connecting.
    const { room } = options
    const onEncryptionStatus = (encrypted: boolean, participant?: Participant) => {
      if (!encrypted && participant && !participant.isLocal) this.block(participant.identity)
    }
    room.on(RoomEvent.ParticipantEncryptionStatusChanged, onEncryptionStatus)
    this.cleanups.push(() => room.off(RoomEvent.ParticipantEncryptionStatusChanged, onEncryptionStatus))
  }

  /** Whether a remote participant's media is blocked for the rest of the call. */
  isBlocked(identity: string): boolean {
    return this.untrusted.has(identity)
  }

  /** Blocks a remote participant for the rest of the call and unsubscribes everything of theirs at once. */
  block(identity: string): void {
    if (this.disposed || !this.markBlocked(identity)) return
    if (this.started) this.apply()
  }

  start(): void {
    if (this.started || this.disposed) return
    this.started = true
    const { room } = this.options
    const refresh = () => this.schedule()
    const onSubscribed = (_track: unknown, publication: RemoteTrackPublication) => {
      // The track exists now, so dimensions can be applied (LiveKit ignores them before).
      this.applied.delete(publication.trackSid)
      this.schedule()
    }
    const onPublished = (publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      // An unencrypted publication blocks its participant now, not on the next coalesced pass.
      if (!publication.isEncrypted) this.block(participant.identity)
      else this.schedule()
    }
    const events: Array<[RoomEvent, (...args: never[]) => void]> = [
      [RoomEvent.TrackPublished, onPublished as never],
      [RoomEvent.TrackUnpublished, refresh],
      [RoomEvent.TrackSubscribed, onSubscribed as never],
      [RoomEvent.TrackUnsubscribed, refresh],
      [RoomEvent.ParticipantConnected, refresh],
      [RoomEvent.ParticipantDisconnected, refresh],
      [RoomEvent.Connected, refresh],
      [RoomEvent.Reconnected, refresh],
      [RoomEvent.ParticipantEncryptionStatusChanged, refresh],
    ]
    for (const [event, handler] of events) {
      room.on(event, handler)
      this.cleanups.push(() => room.off(event, handler))
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', refresh)
      this.cleanups.push(() => document.removeEventListener('visibilitychange', refresh))
    }
    this.schedule()
  }

  /** The tiles the UI currently renders (sizes in device pixels). */
  setTiles(tiles: TileRequest[]): void {
    this.tiles = tiles
    this.schedule()
  }

  setDemand(sourceId: string, demands: VideoDemand[]): () => void {
    const stored = demands.map((demand) => ({ ...demand }))
    this.demands.set(sourceId, stored)
    this.schedule()
    return () => {
      if (this.demands.get(sourceId) === stored) {
        this.demands.delete(sourceId)
        this.schedule()
      }
    }
  }

  schedule(): void {
    if (this.disposed || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.apply()
    }, this.options.delayMs ?? 16)
  }

  /** Recomputes and applies the policy now. */
  apply(): void {
    if (this.disposed) return
    const { room } = this.options
    const publications: PolicyPublication[] = []
    const present = new Set<string>()
    for (const participant of room.remoteParticipants.values()) {
      present.add(participant.identity)
      for (const publication of participant.trackPublications.values()) {
        publications.push({
          trackSid: publication.trackSid,
          identity: participant.identity,
          kind: publication.kind === Track.Kind.Audio ? 'audio' : 'video',
          source: sourceName(publication.source),
          encrypted: publication.isEncrypted,
        })
      }
    }
    this.plan = computeSubscriptions({
      publications,
      tiles: this.tiles,
      documentVisible: typeof document === 'undefined' || document.visibilityState === 'visible',
      demands: [...this.demands.values()].flat(),
      localEncrypted: this.options.localEncrypted(),
      // Only people in the call are reported; someone blocked who rejoins is blocked again.
      untrusted: [...this.untrusted].filter((identity) => present.has(identity)),
    })
    for (const identity of this.plan.blockedIdentities) this.markBlocked(identity)

    const live = new Set<string>()
    for (const decision of this.plan.decisions) {
      live.add(decision.trackSid)
      const participant = room.remoteParticipants.get(decision.identity)
      const publication = participant?.trackPublications.get(decision.trackSid)
      if (participant && publication) this.applyDecision(participant, publication, decision)
    }
    for (const sid of [...this.applied.keys()]) if (!live.has(sid)) this.applied.delete(sid)
    this.options.onPlan?.(this.plan)
  }

  dispose(): void {
    this.disposed = true
    this.started = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    this.demands.clear()
  }

  /** Adds to the sticky block list; true when the identity was not blocked yet. */
  private markBlocked(identity: string): boolean {
    if (this.untrusted.has(identity)) return false
    this.untrusted.add(identity)
    this.options.events.emit('unencrypted.blocked', { identity })
    this.options.onBlocked?.(identity)
    return true
  }

  private applyDecision(
    _participant: RemoteParticipant,
    publication: RemoteTrackPublication,
    decision: SubscriptionDecision,
  ) {
    if (!decision.subscribed) {
      if (publication.isDesired) publication.setSubscribed(false)
      this.applied.delete(decision.trackSid)
      return
    }
    if (!publication.isDesired) publication.setSubscribed(true)
    if (publication.isEnabled !== decision.enabled) publication.setEnabled(decision.enabled)
    if (decision.kind !== 'video' || !decision.enabled || !decision.width || !decision.height) return
    // LiveKit keeps dimensions only once the track exists; re-send after every (re)subscription.
    if (!publication.track) return
    const last = this.applied.get(decision.trackSid)
    if (last && last.width === decision.width && last.height === decision.height && last.track === publication.track)
      return
    publication.setVideoDimensions({ width: decision.width, height: decision.height })
    if (last?.track !== publication.track) publication.emitTrackUpdate()
    this.applied.set(decision.trackSid, { width: decision.width, height: decision.height, track: publication.track })
  }
}
