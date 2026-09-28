/**
 * Public client configuration for `GET /api/config` (server-core, docs/API.md §2): the subset of settings and
 * environment the browser needs. Never secrets.
 *
 * - `buildPublicConfig(settings, env)`: pure.
 * - `getPublicConfig()`: from the cached settings (≤ 5 s) and the environment. The HTTP response stays
 *   `no-store` like every `/api/**` response, so caching happens on the server (decision).
 */
import type { PublicConfig, Settings } from '#shared/schemas/settings'
import { env, type Env } from '../../utils/env'
import { getSettings } from './settings'

export const APP_NAME = 'blinq'

export function buildPublicConfig(
  settings: Settings,
  environment: Pick<Env, 'PUBLIC_URL' | 'LIVEKIT_PUBLIC_URL' | 'smtpEnabled'>,
): PublicConfig {
  return {
    appName: APP_NAME,
    publicUrl: environment.PUBLIC_URL,
    livekitUrl: environment.LIVEKIT_PUBLIC_URL,
    registration: {
      mode: settings['registration.mode'],
      allowedDomains: [...settings['registration.allowedDomains']],
    },
    guestsAllowed: settings['guests.allowed'],
    smtpEnabled: environment.smtpEnabled,
    media: {
      maxCameraResolution: settings['media.maxCameraResolution'],
      maxScreenShareResolution: settings['media.maxScreenShareResolution'],
      maxScreenShareFps: settings['media.maxScreenShareFps'],
    },
    limits: { maxParticipantsPerRoom: settings['limits.maxParticipantsPerRoom'] },
    recording: {
      enabled: settings['recording.enabled'],
      maxDurationMinutes: settings['recording.maxDurationMinutes'],
      maxResolution: settings['recording.maxResolution'],
    },
  }
}

export async function getPublicConfig(): Promise<PublicConfig> {
  return buildPublicConfig(await getSettings(), env())
}
