import { describe, expect, it } from 'vitest'
import { fromBase64Url, toBase64Url } from './encoding'
import {
  decodeRoomKey,
  deriveJoinProof,
  deriveMeetingKeys,
  encodeRoomKey,
  formatSafetyCode,
  generateRoomKey,
  generateSlug,
  isValidSlug,
} from './keys'

const fixedKey = () => Uint8Array.from({ length: 32 }, (_, i) => i)
const epochA = toBase64Url(Uint8Array.from({ length: 16 }, () => 1))
const epochB = toBase64Url(Uint8Array.from({ length: 16 }, () => 2))

describe('room key', () => {
  it('generates 32 random bytes that round-trip through base64url', () => {
    const key = generateRoomKey()
    expect(key).toHaveLength(32)
    expect(decodeRoomKey(encodeRoomKey(key))).toEqual(key)
    expect(encodeRoomKey(key)).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('rejects keys that are not exactly 32 bytes or not base64url', () => {
    expect(() => decodeRoomKey(toBase64Url(new Uint8Array(31)))).toThrow()
    expect(() => decodeRoomKey(toBase64Url(new Uint8Array(33)))).toThrow()
    expect(() => decodeRoomKey('not base64url!')).toThrow()
    expect(() => decodeRoomKey(`${encodeRoomKey(fixedKey())}=`)).toThrow()
  })
})

describe('slug', () => {
  it('has the xxx-xxxx-xxx shape without ambiguous letters', () => {
    for (let i = 0; i < 200; i++) {
      const slug = generateSlug()
      expect(isValidSlug(slug)).toBe(true)
      expect(slug).not.toMatch(/[ilo]/)
    }
  })

  it('rejects malformed slugs', () => {
    expect(isValidSlug('abc-defg-hjk')).toBe(true)
    expect(isValidSlug('abc-defg-hjkm')).toBe(false)
    expect(isValidSlug('ABC-DEFG-HJK')).toBe(false)
    expect(isValidSlug('abi-defg-hjk')).toBe(false)
    expect(isValidSlug('../etc/passwd')).toBe(false)
  })
})

describe('join proof', () => {
  it('is deterministic, 32 bytes, and bound to the slug', async () => {
    const proof = await deriveJoinProof(fixedKey(), 'abc-defg-hjk')
    expect(await deriveJoinProof(fixedKey(), 'abc-defg-hjk')).toBe(proof)
    expect(fromBase64Url(proof)).toHaveLength(32)
    expect(await deriveJoinProof(fixedKey(), 'abc-defg-hjm')).not.toBe(proof)
  })

  it('does not contain the key', async () => {
    const key = fixedKey()
    const proof = await deriveJoinProof(key, 'abc-defg-hjk')
    expect(proof).not.toContain(encodeRoomKey(key))
  })
})

describe('meeting keys', () => {
  it('derive distinct media, chat and safety material per epoch', async () => {
    const a = await deriveMeetingKeys(fixedKey(), epochA, 'abc-defg-hjk')
    const a2 = await deriveMeetingKeys(fixedKey(), epochA, 'abc-defg-hjk')
    const b = await deriveMeetingKeys(fixedKey(), epochB, 'abc-defg-hjk')
    expect(new Uint8Array(a.mediaKey)).toHaveLength(32)
    expect(new Uint8Array(a.mediaKey)).toEqual(new Uint8Array(a2.mediaKey))
    expect(new Uint8Array(a.mediaKey)).not.toEqual(new Uint8Array(b.mediaKey))
    expect(a.safetyCode).toBe(a2.safetyCode)
    expect(a.safetyCode).not.toBe(b.safetyCode)
    expect(a.safetyCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/)
    expect(a.chatKey.extractable).toBe(false)
    expect(a.chatKey.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 })
  })

  it('rejects epochs that are not 16 bytes', async () => {
    await expect(deriveMeetingKeys(fixedKey(), toBase64Url(new Uint8Array(8)), 'abc-defg-hjk')).rejects.toThrow()
  })
})

describe('safety code formatting', () => {
  it('encodes 80 bits as 16 Crockford base32 characters', () => {
    expect(formatSafetyCode(new Uint8Array(10))).toBe('0000-0000-0000-0000')
    expect(formatSafetyCode(new Uint8Array(10).fill(255))).toBe('ZZZZ-ZZZZ-ZZZZ-ZZZZ')
    expect(() => formatSafetyCode(new Uint8Array(9))).toThrow()
  })
})
