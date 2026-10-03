import { describe, expect, it } from 'vitest'
import { SETTINGS_DEFAULTS } from '#shared/schemas/settings'
import { settingsChanges, smtpStatus } from './settings'

describe('smtpStatus', () => {
  it('reports the host and sender when SMTP is configured', () => {
    expect(
      smtpStatus({ smtpEnabled: true, SMTP_HOST: 'smtp.example.test', SMTP_FROM: 'blinq <no-reply@example.test>' }),
    ).toEqual({ configured: true, host: 'smtp.example.test', from: 'blinq <no-reply@example.test>' })
  })

  it('reports nothing when SMTP is off', () => {
    expect(smtpStatus({ smtpEnabled: false, SMTP_HOST: undefined, SMTP_FROM: undefined })).toEqual({
      configured: false,
      host: null,
      from: null,
    })
  })

  it('never includes credentials', () => {
    const status = smtpStatus({
      smtpEnabled: true,
      SMTP_HOST: 'smtp.example.test',
      SMTP_FROM: 'x@example.test',
      // Extra environment values must not leak into the answer.
      ...({ SMTP_USER: 'user', SMTP_PASSWORD: 'change-me-smtp-password' } as object),
    })
    expect(Object.keys(status).sort()).toEqual(['configured', 'from', 'host'])
    expect(JSON.stringify(status)).not.toContain('change-me-smtp-password')
  })
})

describe('settingsChanges', () => {
  it('lists changed keys with their old and new values', () => {
    const after = {
      ...SETTINGS_DEFAULTS,
      'guests.allowed': false,
      'registration.allowedDomains': ['example.com'],
    }
    expect(settingsChanges(SETTINGS_DEFAULTS, after)).toEqual({
      fields: ['registration.allowedDomains', 'guests.allowed'],
      old: { 'registration.allowedDomains': [], 'guests.allowed': true },
      new: { 'registration.allowedDomains': ['example.com'], 'guests.allowed': false },
    })
  })

  it('is empty when nothing changed (arrays compared by value)', () => {
    const same = { ...SETTINGS_DEFAULTS, 'registration.allowedDomains': [] }
    expect(settingsChanges(SETTINGS_DEFAULTS, same)).toEqual({ fields: [], old: {}, new: {} })
  })
})
