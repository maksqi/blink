/**
 * Capture and publish presets derived from the admin media limits (`GET /api/config` → `media`). Pure.
 *
 * - Camera: captured at most at `maxCameraResolution` (720p default), VP8 simulcast with h180 and h360 below the
 *   camera preset, no backup codec, RED off, DTX on (docs/SECURITY.md §3.2: AV1, backup codecs and RED do not work
 *   under E2EE).
 * - Screen share: the best of h720fps5, h720fps15, h720fps30, h1080fps15, h1080fps30 within the resolution and fps
 *   limits; `contentHint` is `detail` up to 15 fps and `motion` at 30 fps (decision).
 */
import { ScreenSharePresets, VideoPresets, type TrackPublishDefaults, type VideoPreset } from 'livekit-client'
import { SETTINGS_DEFAULTS, type PublicConfig } from '#shared/schemas/settings'

export type MediaLimits = PublicConfig['media']

export const DEFAULT_MEDIA_LIMITS: MediaLimits = {
  maxCameraResolution: SETTINGS_DEFAULTS['media.maxCameraResolution'],
  maxScreenShareResolution: SETTINGS_DEFAULTS['media.maxScreenShareResolution'],
  maxScreenShareFps: SETTINGS_DEFAULTS['media.maxScreenShareFps'],
}

export function cameraPreset(limits: MediaLimits): VideoPreset {
  return limits.maxCameraResolution === '1080p' ? VideoPresets.h1080 : VideoPresets.h720
}

/** Simulcast layers published under the camera preset (lowest first). */
export const CAMERA_SIMULCAST_LAYERS: VideoPreset[] = [VideoPresets.h180, VideoPresets.h360]

export type ScreenSharePresetName = 'h720fps5' | 'h720fps15' | 'h720fps30' | 'h1080fps15' | 'h1080fps30'

const SCREEN_SHARE_ORDER: ScreenSharePresetName[] = ['h1080fps30', 'h1080fps15', 'h720fps30', 'h720fps15', 'h720fps5']

export interface ScreenShareChoice {
  name: ScreenSharePresetName
  preset: VideoPreset
  contentHint: 'detail' | 'motion'
}

/** The highest preset within both limits (resolution first, then frame rate); h720fps5 when nothing else fits. */
export function screenSharePreset(limits: MediaLimits): ScreenShareChoice {
  const maxHeight = limits.maxScreenShareResolution === '1080p' ? 1080 : 720
  const maxFps = Number.isFinite(limits.maxScreenShareFps) ? limits.maxScreenShareFps : 15
  const name =
    SCREEN_SHARE_ORDER.find((candidate) => {
      const preset = ScreenSharePresets[candidate]
      return preset.height <= maxHeight && (preset.encoding.maxFramerate ?? 30) <= maxFps
    }) ?? 'h720fps5'
  const preset = ScreenSharePresets[name]
  return { name, preset, contentHint: (preset.encoding.maxFramerate ?? 30) > 15 ? 'motion' : 'detail' }
}

export interface PublishDefaultsInput {
  limits: MediaLimits
  /** False on Safari < 17.2 under E2EE (see support.ts). */
  simulcast: boolean
}

export function buildPublishDefaults({ limits, simulcast }: PublishDefaultsInput): TrackPublishDefaults {
  const camera = cameraPreset(limits)
  const share = screenSharePreset(limits)
  return {
    videoCodec: 'vp8',
    backupCodec: false,
    red: false,
    dtx: true,
    simulcast,
    videoEncoding: camera.encoding,
    videoSimulcastLayers: CAMERA_SIMULCAST_LAYERS,
    screenShareEncoding: share.preset.encoding,
    // Keep the mic flowing on mute so push-to-talk unmutes instantly (the SDK default, stated explicitly).
    stopMicTrackOnMute: false,
  }
}
