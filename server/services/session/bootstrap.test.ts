import { describe, expect, it } from 'vitest'
import { BootstrapError, isPlaceholderSecret, validateBootstrapCredentials } from './bootstrap'

describe('isPlaceholderSecret', () => {
  it.each(['change-me-first-login-password', 'changeme123456789', 'CHANGE-ME', 'replace-me-please', 'placeholder-password', 'password-for-admin', 'secret-admin-pass', 'example-password-1', 'my-change-me-value'])(
    'flags %s',
    (value) => {
      expect(isPlaceholderSecret(value)).toBe(true)
    },
  )

  it.each(['dev-admin-password-0000', 'violet-harbor-lantern-42', 'kX9#mQ2$vL7p'])('accepts %s', (value) => {
    expect(isPlaceholderSecret(value)).toBe(false)
  })
})

describe('validateBootstrapCredentials', () => {
  it('normalizes the email and keeps the password', () => {
    expect(validateBootstrapCredentials('  Admin@Example.TEST ', 'violet-harbor-lantern-42')).toEqual({
      email: 'admin@example.test',
      password: 'violet-harbor-lantern-42',
    })
  })

  it.each([
    [undefined, 'violet-harbor-lantern-42', /Set ADMIN_EMAIL and ADMIN_PASSWORD/],
    ['admin@example.test', undefined, /Set ADMIN_EMAIL and ADMIN_PASSWORD/],
    ['not-an-email', 'violet-harbor-lantern-42', /ADMIN_EMAIL is not a valid/],
    ['admin@example.test', 'change-me-first-login-password', /placeholder/],
    ['admin@example.test', 'short-pw', /shorter than 12/],
    ['admin@example.test', 'qwerty123456', /too common/],
    ['admin@example.test', 'x'.repeat(257), /longer than 256/],
  ])('refuses (%s, %s)', (email, password, message) => {
    expect(() => validateBootstrapCredentials(email, password)).toThrow(BootstrapError)
    expect(() => validateBootstrapCredentials(email, password)).toThrow(message)
  })
})
