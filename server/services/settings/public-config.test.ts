import { describe, expect, it } from 'vitest'
import { publicConfigSchema, SETTINGS_DEFAULTS } from '#shared/schemas/settings'
import { buildPublicConfig } from './public-config'

const environment = { PUBLIC_URL: 'https://meet.example.test', LIVEKIT_PUBLIC_URL: 'wss://meet.example.test', smtpEnabled: false }

describe('buildPublicConfig', () => {
  it('matches publicConfigSchema exactly (no extra keys)', () => {
    const config = buildPublicConfig(SETTINGS_DEFAULTS, environment)
    expect(publicConfigSchema.parse(config)).toEqual(config)
    expect(Object.keys(config).sort()).toEqual(Object.keys(publicConfigSchema.shape).sort())
  })

  it('maps settings and environment values', () => {
    const config = buildPublicConfig(
      {
        ...SETTINGS_DEFAULTS,
        'registration.mode': 'domain',
        'registration.allowedDomains': ['example.com'],
        'guests.allowed': false,
        'media.maxScreenShareFps': 30,
        'limits.maxParticipantsPerRoom': 10,
        'recording.enabled': false,
      },
      { ...environment, smtpEnabled: true },
    )
    expect(config).toEqual({
      appName: 'blinq',
      publicUrl: 'https://meet.example.test',
      livekitUrl: 'wss://meet.example.test',
      registration: { mode: 'domain', allowedDomains: ['example.com'] },
      guestsAllowed: false,
      smtpEnabled: true,
      media: { maxCameraResolution: '720p', maxScreenShareResolution: '1080p', maxScreenShareFps: 30 },
      limits: { maxParticipantsPerRoom: 10 },
      recording: { enabled: false, maxDurationMinutes: 240, maxResolution: '1080p' },
    })
  })

  it('never exposes admin-only settings', () => {
    const json = JSON.stringify(buildPublicConfig(SETTINGS_DEFAULTS, environment))
    for (const hidden of ['retentionDays', 'userQuotaGb', 'maxRoomsPerUser', 'ipRetentionDays']) {
      expect(json).not.toContain(hidden)
    }
  })
})
