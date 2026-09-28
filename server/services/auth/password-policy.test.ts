import { H3Error } from 'h3'
import { describe, expect, it } from 'vitest'
import { assertPasswordAllowed, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordRejection } from './password-policy'

function rejection(run: () => void): { status: number; code: unknown; details: unknown } | null {
  try {
    run()
    return null
  } catch (error) {
    if (!(error instanceof H3Error)) throw error
    const data = error.data as { code?: unknown; details?: unknown }
    return { status: error.statusCode, code: data.code, details: data.details }
  }
}

describe('password policy', () => {
  it('enforces 12..256 characters', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12)
    expect(PASSWORD_MAX_LENGTH).toBe(256)
    expect(passwordRejection('Vq7!mRt2#pL')).toBe('too_short') // 11
    expect(passwordRejection('Vq7!mRt2#pLx')).toBeNull() // 12
    expect(passwordRejection(`Vq7!mRt2#pLx${'z'.repeat(244)}`)).toBeNull() // 256
    expect(passwordRejection(`Vq7!mRt2#pLx${'z'.repeat(245)}`)).toBe('too_long') // 257
  })

  it.each([
    'password1234',
    'Password1234',
    'PASSWORD2024!',
    'p@ssw0rd2024',
    'qwertyuiop123',
    '123456789012',
    'aaaaaaaaaaaa',
    'abcabcabcabc',
    'iloveyou1234',
    'correcthorsebatterystaple',
    'Blinq123456!',
  ])('rejects the common password %s (compared lowercased)', (password) => {
    expect(passwordRejection(password)).toBe('common')
  })

  it.each(['violet-harbor-lantern-42', 'Tr0ub4dor&3-horse', 'mauve kettle orbit 81'])('accepts %s', (password) => {
    expect(passwordRejection(password)).toBeNull()
  })

  it('refuses the current password as the new one', () => {
    expect(passwordRejection('violet-harbor-lantern-42', { current: 'violet-harbor-lantern-42' })).toBe(
      'same_as_current',
    )
    expect(passwordRejection('violet-harbor-lantern-43', { current: 'violet-harbor-lantern-42' })).toBeNull()
  })

  it('maps every rejection to 400 AUTH_PASSWORD_WEAK with details.reason', () => {
    expect(rejection(() => assertPasswordAllowed('password1234'))).toEqual({
      status: 400,
      code: 'AUTH_PASSWORD_WEAK',
      details: { reason: 'common' },
    })
    expect(rejection(() => assertPasswordAllowed('short'))?.details).toEqual({ reason: 'too_short' })
    expect(rejection(() => assertPasswordAllowed('violet-harbor-lantern-42'))).toBeNull()
  })
})
