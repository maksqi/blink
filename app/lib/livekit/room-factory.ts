/**
 * Room factory: every blinq call uses exactly these options (docs/ARCHITECTURE.md §7, docs/SECURITY.md §3.2).
 *
 * - `encryption` (media + data) with `ExternalE2EEKeyProvider({ keySize: 256 })` and the SDK's frame-cryptor worker,
 *   bundled same-origin (`worker-src 'self'`). The deprecated `e2ee` option is never used.
 * - `adaptiveStream: false`: the SubscriptionManager alone picks layers (deterministic tests); `dynacast: true`.
 * - VP8 simulcast (off on Safari < 17.2 under E2EE, which the SDK only guards for the old option), no backup codec,
 *   RED off, DTX on. Camera capture is capped by the admin limit.
 *
 * The room is created when pre-join mounts, so the SDK and the worker are loaded before the user clicks Join.
 */
import E2EEWorker from 'livekit-client/e2ee-worker?worker'
import { ExternalE2EEKeyProvider, Room, setLogLevel, type RoomOptions } from 'livekit-client'
import { buildPublishDefaults, cameraPreset, type MediaLimits } from './presets'
import { canSimulcastWithE2EE, currentBrowserEnv, type BrowserEnv } from './support'

// The SDK logs every connection step at info level; keep the console for warnings and errors.
setLogLevel('warn')

export interface RoomOptionsInput {
  limits: MediaLimits
  simulcast: boolean
}

/** Everything except the encryption part (which needs the worker). */
export function buildRoomOptions({ limits, simulcast }: RoomOptionsInput): RoomOptions {
  return {
    adaptiveStream: false,
    dynacast: true,
    // Remote audio plays through <audio> elements (AudioEngine), never through a WebAudio mix.
    webAudioMix: false,
    // The session owns the pre-join tracks: a server-side unpublish (permission revoked) must not stop them.
    stopLocalTrackOnUnpublish: false,
    publishDefaults: buildPublishDefaults({ limits, simulcast }),
    videoCaptureDefaults: { resolution: cameraPreset(limits).resolution },
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  }
}

export interface CreatedRoom {
  room: Room
  /** Null only for the test-only unencrypted harness client. */
  keyProvider: ExternalE2EEKeyProvider | null
  worker: Worker | null
  simulcast: boolean
}

export interface CreateRoomInput {
  limits: MediaLimits
  /** Always true outside the test-only harness (see session.ts). */
  e2ee: boolean
  env?: BrowserEnv
}

export function createRoom({ limits, e2ee, env = currentBrowserEnv() }: CreateRoomInput): CreatedRoom {
  const simulcast = canSimulcastWithE2EE(env)
  const options = buildRoomOptions({ limits, simulcast })
  if (!e2ee) return { room: new Room(options), keyProvider: null, worker: null, simulcast }

  const keyProvider = new ExternalE2EEKeyProvider({ keySize: 256 })
  const worker = new E2EEWorker()
  const room = new Room({ ...options, encryption: { keyProvider, worker } })
  return { room, keyProvider, worker, simulcast }
}
