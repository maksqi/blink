/**
 * Thin applier for the subscription policy (subscription-policy.ts): collects the inputs from the Room, the rendered
 * tiles and the feature demands, and applies the difference with `setSubscribed`, `setEnabled` and
 * `setVideoDimensions`. Implements `SubscriptionControl` for features (recording uses `setDemand`).
 */
import {
  RoomEvent,
  Track,
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
  private readonly reportedBlocked = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly cleanups: Array<() => void> = []
  private disposed = false

  constructor(private readonly options: SubscriptionManagerOptions) {}

  start(): void {
    const { room } = this.options
    const refresh = () => this.schedule()
    const onSubscribed = (_track: unknown, publication: RemoteTrackPublication) => {
      // The track exists now, so dimensions can be applied (LiveKit ignores them before).
      this.applied.delete(publication.trackSid)
      this.schedule()
    }
    const events: Array<[RoomEvent, (...args: never[]) => void]> = [
      [RoomEvent.TrackPublished, refresh],
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
    for (const participant of room.remoteParticipants.values()) {
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
    })

    const live = new Set<string>()
    for (const decision of this.plan.decisions) {
      live.add(decision.trackSid)
      const participant = room.remoteParticipants.get(decision.identity)
      const publication = participant?.trackPublications.get(decision.trackSid)
      if (participant && publication) this.applyDecision(participant, publication, decision)
      if (decision.blocked && !this.reportedBlocked.has(decision.trackSid)) {
        this.reportedBlocked.add(decision.trackSid)
        this.options.events.emit('unencrypted.blocked', { identity: decision.identity })
      }
    }
    for (const sid of [...this.applied.keys()]) if (!live.has(sid)) this.applied.delete(sid)
    this.options.onPlan?.(this.plan)
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    this.demands.clear()
  }

  private applyDecision(_participant: RemoteParticipant, publication: RemoteTrackPublication, decision: SubscriptionDecision) {
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
    if (last && last.width === decision.width && last.height === decision.height && last.track === publication.track) return
    publication.setVideoDimensions({ width: decision.width, height: decision.height })
    if (last?.track !== publication.track) publication.emitTrackUpdate()
    this.applied.set(decision.trackSid, { width: decision.width, height: decision.height, track: publication.track })
  }
}
