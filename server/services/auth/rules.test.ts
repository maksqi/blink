import { H3Error } from 'h3'
import { describe, expect, it } from 'vitest'
import { emailTokenState, EMAIL_TOKEN_TTL_MS } from './email-tokens'
import { inviteEmail } from './invites'
import { isDomainAllowed } from './registration'

function codeOf(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    if (error instanceof H3Error) return (error.data as { code: string }).code
    throw error
  }
  return undefined
}

describe('domain registration', () => {
  it('matches the email domain exactly and case-insensitively', () => {
    expect(isDomainAllowed('alice@company.com', ['company.com'])).toBe(true)
    expect(isDomainAllowed('Alice@COMPANY.com', ['Company.COM'])).toBe(true)
    expect(isDomainAllowed('alice@sub.company.com', ['company.com'])).toBe(false)
    expect(isDomainAllowed('alice@evilcompany.com', ['company.com'])).toBe(false)
    expect(isDomainAllowed('alice@company.com.evil.test', ['company.com'])).toBe(false)
    expect(isDomainAllowed('alice@company.com', [])).toBe(false)
  })
})

describe('invite email binding', () => {
  it('takes the bound address and rejects another one', () => {
    expect(inviteEmail({ email: 'bound@example.test' }, undefined)).toBe('bound@example.test')
    expect(inviteEmail({ email: 'bound@example.test' }, ' Bound@Example.TEST ')).toBe('bound@example.test')
    expect(codeOf(() => inviteEmail({ email: 'bound@example.test' }, 'other@example.test'))).toBe('INVITE_INVALID')
  })

  it('needs an address for unbound invites', () => {
    expect(inviteEmail({ email: null }, 'New@Example.test')).toBe('new@example.test')
    expect(codeOf(() => inviteEmail({ email: null }, undefined))).toBe('VALIDATION_FAILED')
  })
})

describe('email tokens', () => {
  it('last 24 h (verify) and 1 h (reset)', () => {
    expect(EMAIL_TOKEN_TTL_MS).toEqual({ verify_email: 86_400_000, reset_password: 3_600_000 })
  })

  it('are valid until they expire or are used', () => {
    const now = new Date('2026-09-28T12:00:00Z')
    expect(emailTokenState({ usedAt: null, expiresAt: new Date(now.getTime() + 1) }, now)).toBe('valid')
    expect(emailTokenState({ usedAt: null, expiresAt: now }, now)).toBe('expired')
    expect(emailTokenState({ usedAt: now, expiresAt: new Date(now.getTime() + 1) }, now)).toBe('used')
  })
})
