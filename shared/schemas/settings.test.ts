import { describe, expect, it } from 'vitest'
import { SETTINGS_DEFAULTS, settingsSchema, settingsUpdateSchema } from './settings'

describe('settings schemas', () => {
  it('has defaults for every key', () => {
    expect(settingsSchema.parse({})).toEqual(SETTINGS_DEFAULTS)
    expect(SETTINGS_DEFAULTS['registration.mode']).toBe('invite_only')
    expect(SETTINGS_DEFAULTS['recording.retentionDays']).toBe(30)
  })

  it('update schema never fills in defaults for keys that were not sent', () => {
    expect(settingsUpdateSchema.parse({ 'guests.allowed': false })).toEqual({ 'guests.allowed': false })
    expect(settingsUpdateSchema.parse({})).toEqual({})
  })

  it('update schema rejects unknown keys and invalid values', () => {
    expect(() => settingsUpdateSchema.parse({ 'system.bootstrapDone': true })).toThrow()
    expect(() => settingsUpdateSchema.parse({ 'limits.maxParticipantsPerRoom': 26 })).toThrow()
  })
})
