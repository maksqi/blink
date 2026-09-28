import { H3Error } from 'h3'
import { describe, expect, it } from 'vitest'
import { checkPasswordPolicy } from '../../utils/password'
import { inviteState, inviteStateError, INVITE_TTL_MS } from './invites'
import { wouldRemoveLastAdmin } from './last-admin'
import { generateTempPassword, TEMP_PASSWORD_ALPHABET, TEMP_PASSWORD_LENGTH } from './temp-password'
import { emailDomain, isUniqueViolation, normalizeEmail, toAuthUser, type UserRow } from './users'

describe('last-admin rule', () => {
  it('protects only the last enabled admin', () => {
    expect(wouldRemoveLastAdmin(['a'], 'a')).toBe(true)
    expect(wouldRemoveLastAdmin(['a', 'b'], 'a')).toBe(false)
    expect(wouldRemoveLastAdmin(['a'], 'user-x')).toBe(false) // demoting a non-admin never matters
    expect(wouldRemoveLastAdmin([], 'a')).toBe(false)
  })

  it('covers self-demotion with and without another admin', () => {
    const self = 'admin-self'
    expect(wouldRemoveLastAdmin([self], self)).toBe(true)
    expect(wouldRemoveLastAdmin([self, 'admin-other'], self)).toBe(false)
  })
})

describe('temporary passwords', () => {
  it('are 16 characters from the unambiguous alphabet and pass the policy', () => {
    for (let i = 0; i < 200; i++) {
      const value = generateTempPassword()
      expect(value).toHaveLength(TEMP_PASSWORD_LENGTH)
      expect([...value].every((c) => TEMP_PASSWORD_ALPHABET.includes(c))).toBe(true)
      expect(checkPasswordPolicy(value).ok).toBe(true)
    }
    expect(TEMP_PASSWORD_ALPHABET).not.toMatch(/[0O1lI]/)
  })

  it('retry until the policy passes (a degenerate random source yields a repeat first)', () => {
    let calls = 0
    const value = generateTempPassword((max) => (calls++ < TEMP_PASSWORD_LENGTH ? 0 : calls % max))
    expect(value).not.toBe('a'.repeat(TEMP_PASSWORD_LENGTH))
    expect(checkPasswordPolicy(value).ok).toBe(true)
  })
})

describe('invite state', () => {
  const now = new Date('2026-09-28T12:00:00Z')
  const base = { revokedAt: null, usedAt: null, expiresAt: new Date(now.getTime() + 1_000) }

  it('orders revoked over used over expired', () => {
    expect(inviteState(base, now)).toBe('valid')
    expect(inviteState({ ...base, expiresAt: now }, now)).toBe('expired')
    expect(inviteState({ ...base, usedAt: now, expiresAt: now }, now)).toBe('used')
    expect(inviteState({ ...base, revokedAt: now, usedAt: now }, now)).toBe('revoked')
  })

  it('maps states to the documented errors', () => {
    const code = (state: Parameters<typeof inviteStateError>[0]) => {
      const error = inviteStateError(state)
      expect(error).toBeInstanceOf(H3Error)
      return [error.statusCode, (error.data as { code: string }).code]
    }
    expect(code('unknown')).toEqual([400, 'INVITE_INVALID'])
    expect(code('revoked')).toEqual([400, 'INVITE_INVALID'])
    expect(code('used')).toEqual([410, 'INVITE_USED'])
    expect(code('expired')).toEqual([410, 'INVITE_EXPIRED'])
  })

  it('has the documented lifetimes', () => {
    expect(INVITE_TTL_MS).toEqual({ '24h': 86_400_000, '7d': 604_800_000, '30d': 2_592_000_000 })
  })
})

describe('user helpers', () => {
  it('normalizes emails and extracts the domain', () => {
    expect(normalizeEmail('  Alice@Example.TEST ')).toBe('alice@example.test')
    expect(emailDomain('Bob@Mail.Company.COM')).toBe('mail.company.com')
  })

  it('maps rows to AuthUser without secrets', () => {
    const row = {
      id: '0192d2f4-7a3b-7cde-8f01-23456789abcd',
      email: 'a@example.test',
      displayName: 'A',
      role: 'user',
      passwordHash: '$argon2id$secret',
      mustChangePassword: true,
      emailVerifiedAt: null,
      disabledAt: null,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies UserRow
    expect(toAuthUser(row)).toEqual({
      id: row.id,
      email: 'a@example.test',
      displayName: 'A',
      role: 'user',
      mustChangePassword: true,
      emailVerified: false,
    })
  })

  it('recognizes unique violations directly and wrapped', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
    expect(isUniqueViolation(new Error('Failed query', { cause: { code: '23505' } }))).toBe(true)
    expect(isUniqueViolation(new Error('Failed query', { cause: { code: '23503' } }))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
  })
})
