import { describe, expect, it } from 'vitest'
import { encodeRoomKey, generateRoomKey } from '../e2ee/keys'
import { MEETING_LINK_ERRORS, parseMeetingLink } from './meeting-link'

const ORIGIN = 'https://meet.example.com'
const KEY = encodeRoomKey(generateRoomKey())

describe('parseMeetingLink', () => {
  it('accepts a full link of this server and keeps the fragment', () => {
    const link = `${ORIGIN}/m/abc-defg-hjk#k=${KEY}&t=invite-token-abcdefgh`
    expect(parseMeetingLink(`  ${link}\n`, ORIGIN)).toEqual({ ok: true, slug: 'abc-defg-hjk', href: link })
  })

  it('accepts relative links, a trailing slash and links copied without the scheme', () => {
    const expected = { ok: true, slug: 'abc-defg-hjk', href: `${ORIGIN}/m/abc-defg-hjk#k=${KEY}` }
    expect(parseMeetingLink(`/m/abc-defg-hjk#k=${KEY}`, ORIGIN)).toEqual(expected)
    expect(parseMeetingLink(`${ORIGIN}/m/abc-defg-hjk/#k=${KEY}`, ORIGIN)).toEqual(expected)
    expect(parseMeetingLink(`meet.example.com/m/abc-defg-hjk#k=${KEY}`, ORIGIN)).toEqual(expected)
    expect(parseMeetingLink('localhost:3002/m/abc-defg-hjk', 'http://localhost:3002')).toEqual({
      ok: true,
      slug: 'abc-defg-hjk',
      href: 'http://localhost:3002/m/abc-defg-hjk',
    })
  })

  it('drops the query so nothing from the link reaches the server', () => {
    const result = parseMeetingLink(`${ORIGIN}/m/abc-defg-hjk?k=${KEY}#t=invite-token-abcdefgh`, ORIGIN)
    expect(result).toEqual({ ok: true, slug: 'abc-defg-hjk', href: `${ORIGIN}/m/abc-defg-hjk#t=invite-token-abcdefgh` })
  })

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['javascript:alert(1)', 'invalid'],
    ['ftp://meet.example.com/m/abc-defg-hjk', 'invalid'],
    ['https://user:pass@meet.example.com/m/abc-defg-hjk', 'invalid'],
    ['http://', 'invalid'],
    ['https://evil.example.com/m/abc-defg-hjk#k=x', 'other-server'],
    ['//evil.example.com/m/abc-defg-hjk', 'other-server'],
    ['http://meet.example.com/m/abc-defg-hjk', 'other-server'],
    ['https://meet.example.com:8443/m/abc-defg-hjk', 'other-server'],
    ['https://meet.example.com/dashboard', 'not-meeting'],
    ['https://meet.example.com/m/', 'not-meeting'],
    ['https://meet.example.com/m/abc-defg-hjk/extra', 'not-meeting'],
    ['https://meet.example.com/m/ABC-DEFG-HJK', 'not-meeting'],
    ['https://meet.example.com/m/abc-defg-hji', 'not-meeting'],
    ['abc-defg-hjk', 'not-meeting'],
  ])('rejects %j (%s)', (input, error) => {
    expect(parseMeetingLink(input, ORIGIN)).toEqual({ ok: false, error })
  })

  it('has a message for every error', () => {
    for (const message of Object.values(MEETING_LINK_ERRORS)) expect(message).toMatch(/^[A-Z].+\.$/)
  })
})
