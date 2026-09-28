import { H3Error } from 'h3'
import { describe, expect, it } from 'vitest'
import { SETTINGS_DEFAULTS, settingsUpdateSchema } from '#shared/schemas/settings'
import { applySettingsPatch, mergeSettings, settingsRuleViolation } from './settings'

function failure(fn: () => unknown) {
  try {
    fn()
  } catch (error) {
    if (error instanceof H3Error) {
      return {
        status: error.statusCode,
        data: error.data as { code: string; details: { field?: string; issues: Array<{ path: string }> } },
      }
    }
    throw error
  }
  throw new Error('expected a failure')
}

describe('mergeSettings', () => {
  it('overlays stored values on the defaults and ignores system and unknown keys', () => {
    const invalid: string[] = []
    const merged = mergeSettings(
      [
        { key: 'guests.allowed', value: false },
        { key: 'registration.allowedDomains', value: ['Example.COM'] },
        { key: 'media.maxScreenShareFps', value: 7 },
        { key: 'system.bootstrapDone', value: true },
        { key: 'unknown.key', value: 1 },
      ],
      (key) => invalid.push(key),
    )
    expect(merged['guests.allowed']).toBe(false)
    expect(merged['registration.allowedDomains']).toEqual(['example.com'])
    expect(merged['media.maxScreenShareFps']).toBe(SETTINGS_DEFAULTS['media.maxScreenShareFps'])
    expect(invalid).toEqual(['media.maxScreenShareFps'])
    expect(merged).not.toHaveProperty('system.bootstrapDone')
    expect(merged).not.toHaveProperty('unknown.key')
  })

  it('returns the defaults for an empty table', () => {
    expect(mergeSettings([])).toEqual(SETTINGS_DEFAULTS)
  })
})

describe('applySettingsPatch', () => {
  const smtp = { smtpEnabled: true }

  it('changes only the keys that were sent', () => {
    const current = { ...SETTINGS_DEFAULTS, 'guests.allowed': false, 'limits.maxRoomsPerUser': 7 }
    const { next, changed } = applySettingsPatch(current, { 'recording.enabled': false }, smtp)
    expect(changed).toEqual(['recording.enabled'])
    expect(next['guests.allowed']).toBe(false)
    expect(next['limits.maxRoomsPerUser']).toBe(7)
    expect(next['recording.enabled']).toBe(false)
  })

  it('settingsUpdateSchema keeps only the keys that were sent (no defaults filled in)', () => {
    const parsed = settingsUpdateSchema.parse({ 'recording.enabled': false })
    expect(parsed).toEqual({ 'recording.enabled': false })
    expect('guests.allowed' in parsed).toBe(false)
  })

  it('reports unchanged values as no change', () => {
    expect(applySettingsPatch(SETTINGS_DEFAULTS, { 'guests.allowed': true }, smtp).changed).toEqual([])
  })

  it('rejects unknown keys, system keys and invalid values with VALIDATION_FAILED issues', () => {
    for (const patch of [{ 'system.bootstrapDone': false }, { nope: 1 }, { 'limits.maxParticipantsPerRoom': 26 }, 'x']) {
      const result = failure(() => applySettingsPatch(SETTINGS_DEFAULTS, patch, smtp))
      expect(result.status).toBe(400)
      expect(result.data.code).toBe('VALIDATION_FAILED')
      expect(result.data.details.issues.length).toBeGreaterThan(0)
    }
  })

  it('requires SMTP and at least one domain for domain registration', () => {
    const noSmtp = failure(() =>
      applySettingsPatch(
        SETTINGS_DEFAULTS,
        { 'registration.mode': 'domain', 'registration.allowedDomains': ['example.com'] },
        { smtpEnabled: false },
      ),
    )
    expect(noSmtp.data.details.field).toBe('registration.mode')
    const noDomains = failure(() => applySettingsPatch(SETTINGS_DEFAULTS, { 'registration.mode': 'domain' }, smtp))
    expect(noDomains.data.details.field).toBe('registration.allowedDomains')
    const ok = applySettingsPatch(
      SETTINGS_DEFAULTS,
      { 'registration.mode': 'domain', 'registration.allowedDomains': ['example.com'] },
      smtp,
    )
    expect(ok.changed.sort()).toEqual(['registration.allowedDomains', 'registration.mode'])
  })

  it('exposes the rule check on complete settings', () => {
    expect(settingsRuleViolation(SETTINGS_DEFAULTS, { smtpEnabled: false })).toBeNull()
  })
})
