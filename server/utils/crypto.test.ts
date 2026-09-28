import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  decodeRoomInviteToken,
  deriveRoomInviteKey,
  encodeRoomInviteToken,
  hashToken,
  hkdfSha256,
  hmacSha256,
  isOpaqueToken,
  randomToken,
  safeEqual,
  sha256Hex,
} from './crypto'

describe('randomToken', () => {
  it('returns 32 random bytes as 43 base64url characters by default', () => {
    const token = randomToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
    expect(isOpaqueToken(token)).toBe(true)
  })

  it('never repeats and honors the byte length', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken()))
    expect(tokens.size).toBe(200)
    expect(Buffer.from(randomToken(12), 'base64url')).toHaveLength(12)
  })
})

describe('hashing', () => {
  it('sha256Hex matches known vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex(new Uint8Array([0x61, 0x62, 0x63]))).toBe(sha256Hex('abc'))
  })

  it('hashToken hashes the base64url string as received', () => {
    const token = randomToken()
    expect(hashToken(token)).toBe(createHash('sha256').update(token, 'utf8').digest('hex'))
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hmacSha256 matches node:crypto and RFC 4231 test case 2', () => {
    expect(hmacSha256('Jefe', 'what do ya want for nothing?').toString('hex')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    )
    expect(hmacSha256('k', 'd').equals(createHmac('sha256', 'k').update('d').digest())).toBe(true)
  })

  it('hkdfSha256 matches RFC 5869 test case 1', () => {
    const ikm = Buffer.from('0b'.repeat(22), 'hex')
    const salt = Buffer.from('000102030405060708090a0b0c', 'hex')
    const info = Buffer.from('f0f1f2f3f4f5f6f7f8f9', 'hex')
    expect(hkdfSha256(ikm, info, 42, salt).toString('hex')).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    )
  })
})

describe('safeEqual', () => {
  it('compares strings and bytes', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true)
    expect(safeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false)
  })

  it('handles different lengths without throwing', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false)
    expect(safeEqual('', 'a')).toBe(false)
    expect(safeEqual('', '')).toBe(true)
  })
})

describe('isOpaqueToken', () => {
  it('accepts only 43 base64url characters', () => {
    expect(isOpaqueToken('a'.repeat(43))).toBe(true)
    expect(isOpaqueToken('a'.repeat(42))).toBe(false)
    expect(isOpaqueToken('a'.repeat(44))).toBe(false)
    expect(isOpaqueToken(`${'a'.repeat(42)}=`)).toBe(false)
    expect(isOpaqueToken(`${'a'.repeat(42)}+`)).toBe(false)
    expect(isOpaqueToken(undefined)).toBe(false)
  })
})

describe('room invite tokens', () => {
  const key = deriveRoomInviteKey('test-app-secret-with-at-least-32-characters')
  const inviteId = '0192d2f4-7a3b-7cde-8f01-23456789abcd'

  it('derives k_invite with HKDF(APP_SECRET, info "blinq/v1/invite")', () => {
    expect(key).toHaveLength(32)
    expect(key.equals(hkdfSha256('test-app-secret-with-at-least-32-characters', 'blinq/v1/invite', 32))).toBe(true)
  })

  it('encodes id bytes plus a truncated HMAC and round-trips', () => {
    const token = encodeRoomInviteToken(inviteId, key)
    expect(isOpaqueToken(token)).toBe(true)
    const raw = Buffer.from(token, 'base64url')
    expect(raw.subarray(0, 16).toString('hex')).toBe(inviteId.replace(/-/g, ''))
    expect(raw.subarray(16).equals(hmacSha256(key, raw.subarray(0, 16)).subarray(0, 16))).toBe(true)
    expect(decodeRoomInviteToken(token, key)).toBe(inviteId)
  })

  it('rejects tampered tokens, other keys and malformed input', () => {
    const token = encodeRoomInviteToken(inviteId, key)
    const raw = Buffer.from(token, 'base64url')
    raw[31] = raw[31]! ^ 1
    expect(decodeRoomInviteToken(raw.toString('base64url'), key)).toBeNull()
    expect(decodeRoomInviteToken(token, deriveRoomInviteKey('another-app-secret-with-32-characters-x'))).toBeNull()
    expect(decodeRoomInviteToken('not-a-token', key)).toBeNull()
    expect(() => encodeRoomInviteToken('not-a-uuid', key)).toThrow(TypeError)
  })
})
