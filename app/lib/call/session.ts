/**
 * The call session: one per call page. It owns the LiveKit Room (markRaw), the local tracks, the E2EE keys, the
 * subscription manager, the audio engine and the encrypted messaging, projects everything into the call store, and
 * exposes the `CallContext` features use.
 *
 * Lifecycle: `createCallSession()` in the page's setup (pre-join) → `startPreview()` → `connect(grant)` → `leave()`
 * → `dispose()` on unmount. Creating the session loads the SDK and the E2EE worker and, when the epoch is already
 * known, derives the meeting keys, so the Join click only has to connect (fast join).
 */
import './zod-jitless'
import {
  ConnectionState,
  createLocalScreenTracks,
  LocalVideoTrack,
  RoomEvent,
  Track,
  type DisconnectReason,
  type ExternalE2EEKeyProvider,
  type LocalTrack,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type Room,
  type TrackProcessor,
} from 'livekit-client'
import { computed, effectScope, markRaw, shallowRef, toRef, watch, type EffectScope } from 'vue'
import type { JoinGrant } from '#shared/schemas/join'
import { roomMetadataSchema } from '#shared/schemas/livekit'
import type {
  AudioControl,
  CallContext,
  CallPhase,
  MediaControl,
  MicInsert,
  MicProcessingConstraints,
  ParticipantView,
} from '../contracts/call'
import { testHooks } from '../contracts/test-hooks'
import { buildRoomLink } from '../e2ee/fragment'
import { deriveMeetingKeys, type MeetingKeys, type RoomKey } from '../e2ee/keys'
import { AudioEngine } from '../livekit/audio-engine'
import { resumeSharedAudioContext } from '../livekit/audio-context'
import { connectRoom } from '../livekit/connect'
import { LocalMedia } from '../livekit/local-media'
import { DEFAULT_MEDIA_LIMITS, screenSharePreset, type MediaLimits } from '../livekit/presets'
import { createRoom } from '../livekit/room-factory'
import { collectInboundStats } from '../livekit/stats'
import { SubscriptionManager, sourceName } from '../livekit/subscription-manager'
import type { SubscriptionPlan } from '../livekit/subscription-policy'
import { canShareScreen, currentBrowserEnv, evaluateCallSupport, type CallSupport } from '../livekit/support'
import {
  browserStorage,
  CAPTURE_ERROR_TEXT,
  pickDevice,
  readDevicePrefs,
  toDeviceLists,
  writeDevicePref,
  type DeviceKind,
  type DevicePermission,
} from './devices'
import { outcomeForDisconnect, isTerminalPhase } from './disconnect'
import { createEventBus, type DisposableEventBus } from './event-bus'
import { callRegistry } from './features'
import { createMessaging, type CallMessaging } from './messaging'
import { joinClickMarked, markJoin, markJoinClick, JOIN_MARKS } from './metrics'
import { toParticipantView } from './participant-view'
import { setupFeatures } from './registry'
import { TileTracker } from './tile-tracker'
import { useCallStore, type CallErrorReason, type CallStore, type PublishPermissions } from '~/stores/call'
import { useApi } from '~/composables/useApi'

export type ApiClient = <T>(
  path: string,
  options?: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown },
) => Promise<T>

export interface CallSessionOptions {
  slug: string
  /** The room key K (from the fragment, the tab key or the key vault). Stays inside the session. */
  key: RoomKey
  /** Admin media limits from `GET /api/config` (`media`); defaults to the settings defaults. */
  media?: MediaLimits
  /** `GET /api/config` `publicUrl`, for invite links (defaults to the page origin). */
  publicUrl?: string
  /** `GET /api/config` `livekitUrl`: warms up the connection during pre-join. */
  livekitUrl?: string
  /** Meeting epoch when already known before joining (harness): keys are derived during pre-join. */
  epoch?: string
  /** Pre-join defaults. */
  camera?: boolean
  microphone?: boolean
  /** The room makes everyone join muted (mic and camera off, toggles locked in pre-join). */
  muteOnJoin?: boolean
  /** Test and dev builds only: connect without E2EE (the unencrypted-publisher negative test). */
  testOnlyDisableE2EE?: boolean
  /** API client for `callApi` and invites; defaults to `useApi()` (call createCallSession in setup). */
  api?: ApiClient
}

type VideoSource = 'camera' | 'screen_share'

const LAST_INVITE_EXPIRY = '24h'

function errorMessage(reason: CallErrorReason): string {
  switch (reason) {
    case 'unsupported-browser':
      return "This browser can't join calls. Use a current version of Chrome, Edge, Firefox or Safari."
    case 'unsupported-e2ee':
      return "This browser can't encrypt calls end to end, so blinq won't connect. Use a current version of Chrome, Edge, Firefox or Safari."
    case 'invalid-key':
      return 'The meeting key or epoch is invalid. Ask the host for a new link.'
    case 'connect-failed':
      return 'Could not connect to the meeting. Check your connection and try again.'
    case 'server':
      return 'The meeting server went away. Try joining again.'
    default:
      return 'The connection to the meeting was lost. Try joining again.'
  }
}

export class CallSession {
  readonly id = crypto.randomUUID()
  readonly store: CallStore
  readonly context: CallContext
  readonly events: DisposableEventBus
  readonly support: CallSupport
  /** False only for the test-only unencrypted harness client. */
  readonly e2ee: boolean
  /** Bumped whenever a local or remote track object changes (tiles re-read tracks). */
  readonly trackVersion = shallowRef(0)
  readonly tiles: TileTracker
  readonly limits: MediaLimits

  readonly room: Room | null = null
  private readonly keyProvider: ExternalE2EEKeyProvider | null = null
  private readonly worker: Worker | null = null
  readonly local: LocalMedia
  readonly audio: AudioEngine
  readonly subscriptions: SubscriptionManager | null = null
  private readonly messaging: CallMessaging

  private readonly key: RoomKey
  private keys: MeetingKeys | null = null
  private keysEpoch: string | null = null
  private keysPromise: Promise<MeetingKeys> | null = null
  private grant: JoinGrant | null = null
  private leaving = false
  private disposed = false
  private previewStarted = false
  private readonly scope: EffectScope
  private readonly cleanups: Array<() => void> = []
  private featureCleanup: (() => void) | null = null
  private readonly views = new Map<string, ParticipantView>()
  private viewsScheduled = false
  private audioContainer: HTMLElement | null = null
  private screenTracks: LocalTrack[] = []
  private readonly api: ApiClient
  private readonly options: CallSessionOptions

  constructor(options: CallSessionOptions) {
    this.options = options
    this.key = options.key
    this.limits = options.media ?? DEFAULT_MEDIA_LIMITS
    this.e2ee = !(__BLINQ_TEST_HOOKS__ && options.testOnlyDisableE2EE === true)
    this.store = useCallStore()
    this.store.reset(this.id)
    this.store.slug = options.slug
    this.store.e2eeRequired = this.e2ee
    this.store.muteOnJoin = options.muteOnJoin === true
    this.api = options.api ?? (useApi() as ApiClient)
    this.events = createEventBus()
    this.scope = effectScope(true)
    this.tiles = new TileTracker((tiles) => this.subscriptions?.setTiles(tiles))

    const env = typeof window === 'undefined' ? null : currentBrowserEnv()
    this.support = env ? evaluateCallSupport(env) : { ok: false, reason: 'webrtc' }
    if (!this.support.ok) {
      this.fail(this.support.reason === 'e2ee' ? 'unsupported-e2ee' : 'unsupported-browser')
    } else {
      const created = createRoom({ limits: this.limits, e2ee: this.e2ee, env: env! })
      this.room = markRaw(created.room)
      this.keyProvider = created.keyProvider ? markRaw(created.keyProvider) : null
      this.worker = created.worker
      this.subscriptions = markRaw(
        new SubscriptionManager({
          room: this.room,
          events: this.events,
          localEncrypted: () => this.e2ee && Boolean(this.room?.isE2EEEnabled),
          onPlan: (plan) => this.onPlan(plan),
        }),
      )
    }

    this.local = markRaw(
      new LocalMedia({
        limits: this.limits,
        onStatus: (status) => {
          this.store.media = status
        },
        onTracks: () => this.bumpTracks(),
      }),
    )
    this.audio = markRaw(
      new AudioEngine({
        createElement: () => document.createElement('audio'),
        container: () => this.ensureAudioContainer(),
        hostVolume: (identity) => this.views.get(identity)?.volumeForEveryone ?? 100,
        setMicGain: (gain) => {
          this.local.setMicGain(gain)
          this.store.micGain = gain
        },
        onChange: () => this.publishAudioState(),
      }),
    )
    this.messaging = createMessaging({
      slug: options.slug,
      chatKey: () => this.keys?.chatKey ?? null,
      transport: {
        localIdentity: () =>
          this.room?.state === ConnectionState.Connected ? this.room.localParticipant.identity : null,
        publish: async (bytes, publishOptions) => {
          if (!this.room) throw new Error('Not connected to the call')
          await this.room.localParticipant.publishData(bytes, { reliable: true, ...publishOptions })
        },
      },
      lookup: (identity) => {
        const participant = this.room?.remoteParticipants.get(identity)
        return participant ? this.viewOf(participant) : null
      },
      events: this.events,
    })

    this.context = this.buildContext()
    if (this.room) this.wireRoom(this.room)
    this.featureCleanup = setupFeatures(callRegistry, this.context)
    if (__BLINQ_TEST_HOOKS__) this.installTestHooks()

    if (this.room && options.epoch) void this.ensureKeys(options.epoch).catch(() => undefined)
    if (this.room && options.livekitUrl) void this.room.prepareConnection(options.livekitUrl).catch(() => undefined)
  }

  // ---- Public API ---------------------------------------------------------------------------------------------------

  get phase(): CallPhase {
    return this.store.phase
  }

  /** The host page sets the phases it owns (loading, needKey, info, prejoin, password, waiting). */
  setPhase(phase: CallPhase): void {
    if (this.disposed) return
    this.setPhaseInternal(phase)
  }

  /** Opens camera and microphone for the pre-join preview (with the remembered devices). */
  async startPreview(): Promise<void> {
    if (!this.support.ok || this.disposed) return
    // A remounted pre-join keeps the user's choices; it only refreshes the device lists.
    if (this.previewStarted) return this.refreshDevices()
    this.previewStarted = true
    const prefs = readDevicePrefs(browserStorage())
    const forcedOff = this.store.muteOnJoin
    const wantCamera = this.options.camera !== false && !forcedOff
    const wantMic = this.options.microphone !== false && !forcedOff
    await Promise.allSettled([
      wantCamera ? this.local.enableCamera(prefs.videoinput) : Promise.resolve(),
      wantMic ? this.local.enableMic(prefs.audioinput) : this.local.ensureMic(prefs.audioinput),
    ])
    await this.refreshDevices()
    if (prefs.audiooutput) this.store.outputDevice = prefs.audiooutput
    this.watchDevices()
  }

  /** Call from the Join click handler (before any network request) so the join-time measurement starts there. */
  markJoinClick(): void {
    markJoinClick()
    void resumeSharedAudioContext()
    void this.room?.startAudio().catch(() => undefined)
  }

  /** Connects with a grant from `POST /api/join/:slug` (or the waiting-room SSE `admitted` event). */
  async connect(grant: JoinGrant): Promise<void> {
    const room = this.room
    if (!room || this.disposed) return
    if (this.store.phase === 'connecting' || this.store.phase === 'inCall' || this.store.phase === 'reconnecting')
      return
    if (!joinClickMarked()) this.markJoinClick()
    this.grant = grant
    this.leaving = false
    this.store.roomId = grant.roomId
    this.store.error = null
    this.setPhaseInternal('connecting')

    let keys: MeetingKeys
    try {
      keys = await this.ensureKeys(grant.epoch)
    } catch {
      this.fail('invalid-key')
      return
    }
    this.store.safetyCode = keys.safetyCode

    try {
      await connectRoom({
        room,
        url: grant.url,
        token: grant.token,
        e2ee: this.e2ee,
        keyProvider: this.keyProvider,
        mediaKey: keys.mediaKey,
      })
    } catch (error) {
      if (this.disposed || this.leaving) return
      console.warn('blinq: connect failed', error instanceof Error ? error.name : 'error')
      this.fail('connect-failed')
      return
    }
    if (this.disposed) return
    markJoin(JOIN_MARKS.connected)
    this.store.localIdentity = room.localParticipant.identity
    this.store.connectedAt = Date.now()
    this.syncPermissions()
    this.syncRoomState(room.metadata)
    this.setPhaseInternal('inCall')
    this.scheduleViews()
    this.subscriptions?.start()
    await Promise.allSettled([this.publishLocalTracks(), Promise.resolve(this.subscriptions?.apply())])
    this.scheduleViews()
    if (this.store.outputDevice) void this.audio.setOutputDevice(this.store.outputDevice)
  }

  /** Leaves the call (the phase becomes `left`). */
  async leave(): Promise<void> {
    if (!this.room) return
    this.leaving = true
    await this.stopScreenShare().catch(() => undefined)
    if (this.room.state !== ConnectionState.Disconnected) await this.room.disconnect(true)
    this.setPhaseInternal('left')
    this.releaseMedia()
  }

  dispose(): void {
    if (this.disposed) return
    if (this.room && this.room.state !== ConnectionState.Disconnected) {
      this.leaving = true
      void this.room.disconnect(true)
    }
    this.disposed = true
    this.featureCleanup?.()
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    this.scope.stop()
    this.subscriptions?.dispose()
    this.tiles.dispose()
    this.audio.dispose()
    this.messaging.dispose()
    this.events.clear()
    this.local.dispose()
    for (const track of this.screenTracks.splice(0)) track.stop()
    this.room?.removeAllListeners()
    this.worker?.terminate()
    this.audioContainer?.remove()
    if (__BLINQ_TEST_HOOKS__) {
      const hooks = testHooks()
      if (hooks) {
        delete hooks.publishUnencryptedTrack
        delete hooks.state.call
      }
    }
  }

  // ---- Media controls -------------------------------------------------------------------------------------------------

  async setMicEnabled(enabled: boolean): Promise<void> {
    if (this.disposed) return
    const connected = this.isConnected
    if (enabled) {
      if (connected && !this.store.permissions.microphone) return
      await this.local.enableMic(this.store.media.micDeviceId ?? undefined)
      if (connected) await this.publishMic()
    } else {
      await this.local.disableMic()
    }
    this.scheduleViews()
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (this.disposed) return
    const connected = this.isConnected
    if (enabled) {
      if (connected && !this.store.permissions.camera) return
      await this.local.enableCamera(this.store.media.cameraDeviceId ?? undefined)
      if (connected) await this.publishCamera()
    } else {
      await this.local.disableCamera()
    }
    this.scheduleViews()
  }

  toggleMic(): Promise<void> {
    return this.setMicEnabled(!this.store.media.micOn)
  }

  toggleCamera(): Promise<void> {
    return this.setCameraEnabled(!this.store.media.cameraOn)
  }

  async selectDevice(kind: DeviceKind, deviceId: string): Promise<void> {
    writeDevicePref(browserStorage(), kind, deviceId)
    if (kind === 'videoinput') await this.local.switchCamera(deviceId).catch(() => undefined)
    else if (kind === 'audioinput') await this.local.switchMic(deviceId).catch(() => undefined)
    else {
      this.store.outputDevice = deviceId
      await this.audio.setOutputDevice(deviceId)
    }
    if (kind !== 'audiooutput') this.store.media = { ...this.local.status }
  }

  get canShareScreen(): boolean {
    if (!this.support.ok || typeof window === 'undefined') return false
    if (!canShareScreen(currentBrowserEnv())) return false
    if (!this.store.permissions.screenShare) return false
    const policy = this.store.roomState?.screenSharePolicy ?? 'everyone'
    return policy === 'everyone' || this.store.isModerator
  }

  async startScreenShare(): Promise<void> {
    const room = this.room
    if (!room || !this.isConnected || this.store.screenShare.active || this.store.screenShare.busy) return
    const choice = screenSharePreset(this.limits)
    this.store.screenShare = { active: false, busy: true }
    try {
      let tracks: LocalTrack[]
      const fake = __BLINQ_TEST_HOOKS__ ? await import('./test-support') : null
      if (fake?.fakeScreenSourceEnabled()) {
        const { width, height, frameRate } = choice.preset.resolution
        const source = fake.canvasSource(1920, 1080, frameRate ?? 15, `screen ${width}x${height}`)
        const video = new LocalVideoTrack(source.track, undefined, true)
        video.source = Track.Source.ScreenShare
        video.on('ended', () => source.stop())
        tracks = [video]
      } else {
        tracks = await createLocalScreenTracks({
          audio: this.store.permissions.screenShareAudio,
          resolution: choice.preset.resolution,
          contentHint: choice.contentHint,
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
          systemAudio: 'include',
        })
      }
      this.screenTracks = tracks.map((track) => markRaw(track))
      for (const track of this.screenTracks) {
        if (track.kind === Track.Kind.Video) {
          track.mediaStreamTrack.contentHint = choice.contentHint
          await room.localParticipant.publishTrack(track, {
            source: Track.Source.ScreenShare,
            screenShareEncoding: choice.preset.encoding,
            degradationPreference: choice.contentHint === 'detail' ? 'maintain-resolution' : 'balanced',
          })
        } else if (this.store.permissions.screenShareAudio) {
          await room.localParticipant.publishTrack(track, {
            source: Track.Source.ScreenShareAudio,
            dtx: false,
            red: false,
          })
        } else {
          track.stop()
        }
      }
      this.store.screenShare = { active: true, busy: false }
      if (__BLINQ_TEST_HOOKS__) {
        const hooks = testHooks()
        const video = this.screenTracks.find((track) => track.kind === Track.Kind.Video)
        const settings = video?.mediaStreamTrack.getSettings()
        if (hooks) {
          hooks.state.localScreen = {
            preset: choice.name,
            contentHint: video?.mediaStreamTrack.contentHint ?? '',
            width: settings?.width ?? 0,
            height: settings?.height ?? 0,
            maxBitrate: choice.preset.encoding.maxBitrate,
            maxFramerate: choice.preset.encoding.maxFramerate,
          }
        }
      }
    } catch (error) {
      for (const track of this.screenTracks.splice(0)) track.stop()
      this.store.screenShare = { active: false, busy: false }
      // The user closing the picker is not an error.
      if (error instanceof DOMException && error.name === 'NotAllowedError') return
      throw error
    } finally {
      this.bumpTracks()
      this.scheduleViews()
    }
  }

  async stopScreenShare(): Promise<void> {
    const room = this.room
    const tracks = this.screenTracks.splice(0)
    for (const track of tracks) {
      if (room && room.state !== ConnectionState.Disconnected) {
        await room.localParticipant.unpublishTrack(track, true).catch(() => undefined)
      }
      track.stop()
    }
    this.store.screenShare = { active: false, busy: false }
    this.bumpTracks()
    this.scheduleViews()
  }

  /** Starts audio elements the browser blocked (from a click). */
  async unlockAudio(): Promise<void> {
    await this.room?.startAudio().catch(() => undefined)
    await this.audio.resume()
    await resumeSharedAudioContext()
    this.store.audioBlocked = this.room ? !this.room.canPlaybackAudio : false
  }

  setLocalVolume(identity: string, volume: number): void {
    this.audio.setLocalVolume(identity, volume)
    this.store.localVolumes = { ...this.store.localVolumes, [identity]: this.audio.getLocalVolume(identity) }
  }

  togglePin(identity: string): void {
    this.store.pinned = this.store.pinned === identity ? null : identity
  }

  /** Creates a 24 h invite (hosts and co-hosts) and returns the link with the key in the fragment. */
  async createInviteLink(): Promise<string> {
    const roomId = this.store.roomId
    if (!roomId) throw new Error('Not in a call')
    const { invite } = await this.api<{ invite: { token: string } }>(
      `/api/rooms/${encodeURIComponent(roomId)}/invites`,
      {
        method: 'POST',
        body: { expiresIn: LAST_INVITE_EXPIRY },
      },
    )
    const base = this.options.publicUrl ?? window.location.origin
    return buildRoomLink(base, this.options.slug, this.key, invite.token)
  }

  // ---- Tracks for tiles -------------------------------------------------------------------------------------------------

  /** The video track to render for a participant and source (null when off, blocked or not subscribed). */
  videoTrack(identity: string, source: VideoSource): LocalVideoTrack | RemoteTrack | null {
    void this.trackVersion.value
    const room = this.room
    if (!room) return null
    const lkSource = source === 'camera' ? Track.Source.Camera : Track.Source.ScreenShare
    const localIdentity = this.store.localIdentity
    if (identity === localIdentity) {
      if (source === 'camera') return this.local.camera && !this.local.camera.isMuted ? this.local.camera : null
      return null
    }
    const participant = room.remoteParticipants.get(identity)
    const publication = participant?.getTrackPublication(lkSource) as RemoteTrackPublication | undefined
    if (!publication || !publication.isEncrypted || publication.isMuted) return null
    return publication.track ?? null
  }

  /** The local camera for previews (pre-join and self view). */
  previewTrack(): LocalVideoTrack | null {
    void this.trackVersion.value
    return this.local.camera && !this.local.camera.isMuted ? this.local.camera : null
  }

  /** Mic level after the gain, 0..1 (pre-join meter). */
  micLevel(): number {
    if (!this.local.mic || this.local.mic.isMuted) return 0
    return this.local.chain.level()
  }

  // ---- Internals -------------------------------------------------------------------------------------------------------

  private get isConnected(): boolean {
    return this.room?.state === ConnectionState.Connected || this.room?.state === ConnectionState.Reconnecting
  }

  private buildContext(): CallContext {
    const store = this.store
    const room = shallowRef(this.room)
    const media: MediaControl = {
      cameraTrack: () => this.local.cameraTrack(),
      micTrack: () => this.local.micTrack(),
      audioContext: () => this.local.audioContext,
      setCameraProcessor: (processor: TrackProcessor<Track.Kind.Video> | null) =>
        this.local.setCameraProcessor(processor),
      setMicInsert: (insert: MicInsert | null) => this.local.setMicInsert(insert),
      setMicProcessing: (constraints: MicProcessingConstraints) => this.local.setMicProcessing(constraints),
    }
    const audio: AudioControl = {
      setLocalVolume: (identity, volume) => this.setLocalVolume(identity, volume),
      getLocalVolume: (identity) => this.audio.getLocalVolume(identity),
      setMicGain: (gain) => this.audio.setMicGain(gain),
      remoteAudioTracks: () => this.audio.remoteAudioTracks(),
    }
    return {
      room,
      roomId: toRef(store, 'roomId'),
      slug: toRef(store, 'slug'),
      phase: toRef(store, 'phase'),
      self: computed(() => store.self),
      participants: computed(() => store.participants),
      roomState: computed(() => store.roomState),
      layout: toRef(store, 'layout'),
      messaging: {
        send: (type, body, sendOptions) => this.messaging.send(type, body, sendOptions),
        on: (type, handler) => this.messaging.on(type, handler),
      },
      subscriptions: {
        setDemand: (sourceId, demands) => this.subscriptions?.setDemand(sourceId, demands) ?? (() => undefined),
      },
      audio,
      media,
      events: this.events,
      callApi: <T>(path: string, callOptions?: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown }) => {
        const roomId = store.roomId
        if (!roomId) return Promise.reject(new Error('Not in a call'))
        const suffix = path.startsWith('/') ? path : `/${path}`
        return this.api<T>(`/api/calls/${encodeURIComponent(roomId)}${suffix}`, {
          method: callOptions?.method ?? 'GET',
          body: callOptions?.body,
        })
      },
    }
  }

  private async ensureKeys(epoch: string): Promise<MeetingKeys> {
    if (this.keys && this.keysEpoch === epoch) return this.keys
    if (!this.keysPromise || this.keysEpoch !== epoch) {
      this.keysEpoch = epoch
      this.keysPromise = deriveMeetingKeys(this.key, epoch, this.options.slug).then((keys) => {
        if (this.keysEpoch === epoch) this.keys = keys
        return keys
      })
      this.keysPromise.catch(() => {
        if (this.keysEpoch === epoch) this.keysPromise = null
      })
    }
    return this.keysPromise
  }

  private setPhaseInternal(phase: CallPhase) {
    if (this.store.phase === phase) return
    this.store.setPhase(phase)
    this.events.emit('call.phase', phase)
  }

  private fail(reason: CallErrorReason) {
    this.store.error = { reason, message: errorMessage(reason) }
    this.setPhaseInternal('error')
  }

  private wireRoom(room: Room) {
    const views = () => this.scheduleViews()
    const tracksChanged = () => {
      this.bumpTracks()
      this.scheduleViews()
    }

    room
      .on(RoomEvent.ParticipantConnected, (participant) => {
        this.scheduleViews()
        this.events.emit('participant.joined', this.viewOf(participant))
      })
      .on(RoomEvent.ParticipantDisconnected, (participant) => {
        this.views.delete(participant.identity)
        this.store.undecryptable = this.store.undecryptable.filter((id) => id !== participant.identity)
        if (this.store.pinned === participant.identity) this.store.pinned = null
        if (this.store.activeSpeaker === participant.identity) this.store.activeSpeaker = null
        this.scheduleViews()
        this.events.emit('participant.left', { identity: participant.identity })
      })
      .on(RoomEvent.TrackPublished, tracksChanged)
      .on(RoomEvent.TrackUnpublished, (publication) => {
        this.audio.removeTrack(publication.trackSid)
        tracksChanged()
      })
      .on(RoomEvent.TrackSubscribed, (track, publication, participant) =>
        this.onTrackSubscribed(track, publication, participant),
      )
      .on(RoomEvent.TrackUnsubscribed, (_track, publication) => {
        this.audio.removeTrack(publication.trackSid)
        tracksChanged()
      })
      .on(RoomEvent.TrackMuted, tracksChanged)
      .on(RoomEvent.TrackUnmuted, tracksChanged)
      .on(RoomEvent.LocalTrackPublished, tracksChanged)
      .on(RoomEvent.LocalTrackUnpublished, (publication) => this.onLocalUnpublished(publication))
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) => this.onActiveSpeakers(speakers))
      .on(RoomEvent.ConnectionQualityChanged, views)
      .on(RoomEvent.ParticipantNameChanged, views)
      .on(RoomEvent.ParticipantAttributesChanged, () => {
        this.scheduleViews()
        this.audio.refreshVolumes()
      })
      .on(RoomEvent.ParticipantPermissionsChanged, (_previous, participant) => {
        if (participant.isLocal) this.syncPermissions()
      })
      .on(RoomEvent.RoomMetadataChanged, (metadata) => this.syncRoomState(metadata))
      .on(RoomEvent.DataReceived, (payload, participant, _kind, topic, encryptionType) => {
        void this.messaging.handlePacket({ payload, senderIdentity: participant?.identity, topic, encryptionType })
      })
      .on(RoomEvent.Reconnecting, () => this.onReconnecting())
      .on(RoomEvent.SignalReconnecting, () => this.onReconnecting())
      .on(RoomEvent.Reconnected, () => {
        if (this.store.phase === 'reconnecting') {
          this.store.reconnectedAt = Date.now()
          this.setPhaseInternal('inCall')
        }
        this.syncPermissions()
        this.scheduleViews()
      })
      .on(RoomEvent.Disconnected, (reason) => this.onDisconnected(reason))
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        this.store.audioBlocked = !room.canPlaybackAudio
      })
      .on(RoomEvent.EncryptionError, (_error, participant) => {
        if (!participant || participant.isLocal) return
        if (!this.store.undecryptable.includes(participant.identity)) {
          this.store.undecryptable = [...this.store.undecryptable, participant.identity]
        }
      })
      .on(RoomEvent.ParticipantEncryptionStatusChanged, (_encrypted, participant) => {
        if (!participant || participant.isLocal) this.store.e2eeEnabled = this.e2ee && room.isE2EEEnabled
        this.scheduleViews()
      })
      .on(RoomEvent.MediaDevicesChanged, () => void this.refreshDevices())
  }

  private onTrackSubscribed(track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) {
    // Defense in depth: the policy never subscribes NONE, but never play one even if it happened.
    if (!publication.isEncrypted) {
      publication.setSubscribed(false)
      return
    }
    if (track.kind === Track.Kind.Audio) {
      const source = publication.source === Track.Source.ScreenShareAudio ? 'screen_share_audio' : 'microphone'
      this.audio.addTrack(
        participant.identity,
        source,
        track as unknown as Parameters<AudioEngine['addTrack']>[2],
        true,
      )
    }
    this.bumpTracks()
    this.scheduleViews()
  }

  private onLocalUnpublished(publication: LocalTrackPublication) {
    const source = publication.source
    if (source === Track.Source.ScreenShare || source === Track.Source.ScreenShareAudio) {
      // Ended from the browser's "Stop sharing" bar (the SDK unpublishes it).
      const remaining = this.screenTracks.filter((track) => track !== publication.track)
      if (remaining.length !== this.screenTracks.length) {
        publication.track?.stop()
        this.screenTracks = remaining
      }
      if (!this.screenTracks.some((track) => track.kind === Track.Kind.Video)) {
        for (const track of this.screenTracks.splice(0)) {
          void this.room?.localParticipant.unpublishTrack(track, true).catch(() => undefined)
          track.stop()
        }
        this.store.screenShare = { active: false, busy: false }
      }
    }
    // Camera and mic unpublishes also happen during a full reconnect (the SDK republishes the same tracks), so they
    // never mute here; a revoked permission is handled in syncPermissions().
    this.bumpTracks()
    this.scheduleViews()
  }

  private onActiveSpeakers(speakers: Participant[]) {
    const remote = speakers.find((speaker) => !speaker.isLocal)
    if (remote) this.store.activeSpeaker = remote.identity
    this.scheduleViews()
  }

  private onReconnecting() {
    if (this.store.phase === 'inCall') this.setPhaseInternal('reconnecting')
  }

  private onDisconnected(reason?: DisconnectReason) {
    if (this.disposed) return
    const outcome = outcomeForDisconnect(reason, this.leaving)
    this.audio.dispose()
    if (outcome.phase === 'error') this.fail(outcome.reason === 'server' ? 'server' : 'connection-lost')
    else this.setPhaseInternal(outcome.phase)
    this.releaseMedia()
    this.scheduleViews()
  }

  private releaseMedia() {
    for (const track of this.screenTracks.splice(0)) track.stop()
    this.store.screenShare = { active: false, busy: false }
    this.local.dispose()
    this.bumpTracks()
  }

  private async publishLocalTracks(): Promise<void> {
    if (this.store.muteOnJoin) {
      await this.local.disableMic().catch(() => undefined)
      await this.local.disableCamera().catch(() => undefined)
    }
    await Promise.allSettled([this.publishMic(), this.store.media.cameraOn ? this.publishCamera() : Promise.resolve()])
  }

  private async publishMic(): Promise<void> {
    const room = this.room
    const mic = this.local.mic
    if (!room || !mic || !this.store.permissions.microphone) return
    if (room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track === mic) return
    try {
      await room.localParticipant.publishTrack(mic, { source: Track.Source.Microphone })
    } catch (error) {
      console.warn('blinq: could not publish the microphone', error instanceof Error ? error.name : 'error')
    }
    this.bumpTracks()
  }

  private async publishCamera(): Promise<void> {
    const room = this.room
    const camera = this.local.camera
    if (!room || !camera || camera.isMuted || !this.store.permissions.camera) return
    if (room.localParticipant.getTrackPublication(Track.Source.Camera)?.track === camera) return
    try {
      await room.localParticipant.publishTrack(camera, { source: Track.Source.Camera })
    } catch (error) {
      console.warn('blinq: could not publish the camera', error instanceof Error ? error.name : 'error')
    }
    this.bumpTracks()
  }

  private syncPermissions() {
    const permission = this.room?.localParticipant.permissions
    let next: PublishPermissions
    if (!permission) {
      next = { camera: true, microphone: true, screenShare: true, screenShareAudio: true }
    } else if (!permission.canPublish) {
      next = { camera: false, microphone: false, screenShare: false, screenShareAudio: false }
    } else if (permission.canPublishSources.length === 0) {
      next = { camera: true, microphone: true, screenShare: true, screenShareAudio: true }
    } else {
      const sources = new Set(permission.canPublishSources.map((source) => Track.sourceFromProto(source)))
      next = {
        camera: sources.has(Track.Source.Camera),
        microphone: sources.has(Track.Source.Microphone),
        screenShare: sources.has(Track.Source.ScreenShare),
        screenShareAudio: sources.has(Track.Source.ScreenShareAudio),
      }
    }
    const previous = this.store.permissions
    this.store.permissions = next
    // The host took a source away: stop sending it locally too (the server already unpublished it).
    if (previous.microphone && !next.microphone) void this.local.disableMic().catch(() => undefined)
    if (previous.camera && !next.camera) void this.local.disableCamera().catch(() => undefined)
    if (!next.screenShare && this.store.screenShare.active) void this.stopScreenShare()
  }

  private syncRoomState(metadata: string | undefined) {
    if (!metadata) return
    let parsed: unknown
    try {
      parsed = JSON.parse(metadata)
    } catch {
      return
    }
    const result = roomMetadataSchema.safeParse(parsed)
    if (!result.success) return // invalid metadata is ignored, never half-applied
    this.store.roomState = result.data
    this.events.emit('room.state', result.data)
    if (this.store.screenShare.active && !this.canShareScreen) void this.stopScreenShare()
  }

  private viewOf(participant: Participant): ParticipantView {
    return toParticipantView(participant, {
      localEncrypted: this.e2ee && Boolean(this.room?.isE2EEEnabled),
      now: this.store.connectedAt ?? Date.now(),
    })
  }

  private scheduleViews() {
    if (this.viewsScheduled || this.disposed) return
    this.viewsScheduled = true
    queueMicrotask(() => {
      this.viewsScheduled = false
      this.rebuildViews()
    })
  }

  private rebuildViews() {
    const room = this.room
    if (!room || this.disposed) return
    const next: ParticipantView[] = []
    const connected = room.state !== ConnectionState.Disconnected
    const all: Participant[] = connected ? [room.localParticipant, ...room.remoteParticipants.values()] : []
    for (const participant of all) {
      const view = this.viewOf(participant)
      const previous = this.views.get(view.identity)
      const same =
        previous &&
        (Object.keys(view) as Array<keyof ParticipantView>).every((key) => Object.is(previous[key], view[key]))
      const kept = same ? previous : view
      this.views.set(view.identity, kept)
      next.push(kept)
    }
    for (const identity of [...this.views.keys()])
      if (!next.some((view) => view.identity === identity)) this.views.delete(identity)
    next.sort((a, b) =>
      a.isLocal !== b.isLocal ? (a.isLocal ? -1 : 1) : a.joinedAt - b.joinedAt || a.identity.localeCompare(b.identity),
    )
    const current = this.store.participants
    if (current.length !== next.length || current.some((view, index) => view !== next[index]))
      this.store.participants = next
    this.store.blocked = this.subscriptions?.plan.blockedIdentities ?? []
    this.store.e2eeEnabled = this.e2ee && room.isE2EEEnabled
  }

  private onPlan(plan: SubscriptionPlan) {
    const blocked = plan.blockedIdentities
    if (blocked.join('\u0000') !== this.store.blocked.join('\u0000')) this.store.blocked = blocked
    if (__BLINQ_TEST_HOOKS__) {
      const hooks = testHooks()
      if (hooks) hooks.state.subscriptions = Object.fromEntries(plan.decisions.map((d) => [d.trackSid, { ...d }]))
    }
  }

  private bumpTracks() {
    this.trackVersion.value++
  }

  private ensureAudioContainer(): HTMLElement {
    if (!this.audioContainer || !this.audioContainer.isConnected) {
      const element = document.createElement('div')
      element.dataset.blinqAudio = ''
      element.hidden = true
      document.body.append(element)
      this.audioContainer = element
    }
    return this.audioContainer
  }

  private async refreshDevices() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return
    try {
      const lists = toDeviceLists(await navigator.mediaDevices.enumerateDevices())
      this.store.devices = lists
      // A device that vanished (unplugged headset): move to the next one.
      const media = this.store.media
      if (
        this.local.camera &&
        media.cameraDeviceId &&
        !lists.videoinput.some((d) => d.deviceId === media.cameraDeviceId)
      ) {
        const next = pickDevice(lists.videoinput)
        if (next) void this.local.switchCamera(next).catch(() => undefined)
      }
      if (this.local.mic && media.micDeviceId && !lists.audioinput.some((d) => d.deviceId === media.micDeviceId)) {
        const next = pickDevice(lists.audioinput)
        if (next) void this.local.switchMic(next).catch(() => undefined)
      }
    } catch {
      // enumerateDevices can fail in locked-down browsers; the pickers stay empty.
    }
    await this.refreshDevicePermissions()
  }

  private async refreshDevicePermissions() {
    const query = async (name: 'camera' | 'microphone'): Promise<DevicePermission> => {
      try {
        const status = await navigator.permissions.query({ name: name as PermissionName })
        return status.state
      } catch {
        return 'unknown'
      }
    }
    const media = this.store.media
    const [camera, microphone] = await Promise.all([query('camera'), query('microphone')])
    this.store.devicePermissions = {
      camera: media.cameraError === 'denied' ? 'denied' : camera,
      microphone: media.micError === 'denied' ? 'denied' : microphone,
    }
  }

  private watchDevices() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) return
    const onChange = () => void this.refreshDevices()
    navigator.mediaDevices.addEventListener('devicechange', onChange)
    this.cleanups.push(() => navigator.mediaDevices.removeEventListener('devicechange', onChange))
  }

  private publishAudioState() {
    if (!__BLINQ_TEST_HOOKS__) return
    const hooks = testHooks()
    if (hooks) hooks.state.audio = this.audio.snapshot()
  }

  private installTestHooks() {
    const hooks = testHooks()
    if (!hooks) return
    void import('./test-support').then((support) => {
      if (this.disposed) return
      hooks.useFakeScreenSource = (enabled) => support.setFakeScreenSource(enabled)
      if (!this.e2ee && this.room) {
        const room = this.room
        hooks.publishUnencryptedTrack = () => support.publishUnencryptedTrack(room)
      } else {
        delete hooks.publishUnencryptedTrack
      }
    })
    this.scope.run(() => {
      watch(
        () => [
          this.store.phase,
          this.store.participants,
          this.store.e2eeEnabled,
          this.store.blocked,
          this.store.undecryptable,
          this.store.media,
          this.store.screenShare,
          this.store.phaseHistory,
          this.store.permissions,
          this.store.layout,
          this.store.pinned,
          this.store.micGain,
          this.store.localVolumes,
        ],
        () => {
          hooks.state.call = {
            phase: this.store.phase,
            phaseHistory: [...this.store.phaseHistory],
            identity: this.store.localIdentity,
            e2eeEnabled: this.store.e2eeEnabled,
            badge: this.store.e2eeBadge,
            blocked: [...this.store.blocked],
            undecryptable: [...this.store.undecryptable],
            media: { ...this.store.media },
            screenShare: { ...this.store.screenShare },
            permissions: { ...this.store.permissions },
            layout: this.store.layout,
            pinned: this.store.pinned,
            micGain: this.store.micGain,
            localVolumes: { ...this.store.localVolumes },
            participants: this.store.participants.map((p) => ({ ...p })),
            safetyCode: this.store.safetyCode,
          }
        },
        { immediate: true, flush: 'sync' },
      )
    })
    const timer = setInterval(() => {
      const room = this.room
      if (!room || room.state !== ConnectionState.Connected) return
      void collectInboundStats(room).then((stats) => {
        hooks.state.inboundVideo = stats.video
        hooks.state.inboundAudio = stats.audio
      })
      hooks.state.audio = this.audio.snapshot()
    }, 500)
    this.cleanups.push(() => clearInterval(timer))
  }
}

/** Creates the session for one call page. Call it in `setup()` (it uses Pinia and `useApi()`). */
export function createCallSession(options: CallSessionOptions): CallSession {
  return markRaw(new CallSession(options))
}

export { CAPTURE_ERROR_TEXT, isTerminalPhase, sourceName }
