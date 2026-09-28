import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { opaqueTokenSchema } from '#shared/schemas/common'
import { inviteIdFromToken, inviteTokenFor } from './token'

const SECRET = 'unit-app-secret-unit-app-secret-0000000000'
const OTHER_SECRET = 'another-app-secret-another-app-secret-0000'

function flip(token: string, index: number): string {
  const bytes = Buffer.from(token, 'base64url')
  bytes[index]! ^= 0x01
  return bytes.toString('base64url')
}

describe('room invite tokens', () => {
  it('round-trips the invite id and has the opaque token shape (43 chars)', () => {
    const id = randomUUID()
    const token = inviteTokenFor(id, SECRET)
    expect(opaqueTokenSchema.safeParse(token).success).toBe(true)
    expect(inviteIdFromToken(token, SECRET)).toBe(id)
    // Deterministic: the owner can re-derive the same link any time.
    expect(inviteTokenFor(id, SECRET)).toBe(token)
  })

  it('contains the id bytes followed by a 16-byte MAC', () => {
    const id = randomUUID()
    const raw = Buffer.from(inviteTokenFor(id, SECRET), 'base64url')
    expect(raw.length).toBe(32)
    expect(raw.subarray(0, 16).toString('hex')).toBe(id.replace(/-/g, ''))
  })

  it('rejects any flipped bit in the id or the MAC', () => {
    const token = inviteTokenFor(randomUUID(), SECRET)
    for (const index of [0, 7, 15, 16, 24, 31]) expect(inviteIdFromToken(flip(token, index), SECRET)).toBeNull()
  })

  it('rejects tokens made with another secret, truncated or malformed tokens', () => {
    const id = randomUUID()
    expect(inviteIdFromToken(inviteTokenFor(id, OTHER_SECRET), SECRET)).toBeNull()
    const token = inviteTokenFor(id, SECRET)
    expect(inviteIdFromToken(token.slice(0, 42), SECRET)).toBeNull()
    expect(inviteIdFromToken(`${token}A`, SECRET)).toBeNull()
    expect(inviteIdFromToken('not a token at all, not a token at all!!!!!', SECRET)).toBeNull()
  })

  it('cannot move a MAC to another invite id', () => {
    const a = Buffer.from(inviteTokenFor(randomUUID(), SECRET), 'base64url')
    const b = Buffer.from(inviteTokenFor(randomUUID(), SECRET), 'base64url')
    const forged = Buffer.concat([b.subarray(0, 16), a.subarray(16)]).toString('base64url')
    expect(inviteIdFromToken(forged, SECRET)).toBeNull()
  })
})
