import { describe, expect, it } from 'vitest'
import { buildRoomLink, parseRoomFragment, parseTokenFragment } from './fragment'
import { encodeRoomKey, generateRoomKey } from './keys'

describe('room fragment', () => {
  it('builds links with every secret in the fragment', () => {
    const key = generateRoomKey()
    const link = buildRoomLink('https://meet.example.com/', 'abc-defg-hjk', key, 'invite-token-abcdefgh')
    const url = new URL(link)
    expect(url.origin).toBe('https://meet.example.com')
    expect(url.pathname).toBe('/m/abc-defg-hjk')
    expect(url.search).toBe('')
    expect(url.hash).toContain(encodeRoomKey(key))
    const parsed = parseRoomFragment(url.hash)
    expect(parsed.key).toEqual(key)
    expect(parsed.inviteToken).toBe('invite-token-abcdefgh')
    expect(parsed.invalidKey).toBe(false)
  })

  it('flags truncated keys and ignores junk tokens', () => {
    const encoded = encodeRoomKey(generateRoomKey())
    const parsed = parseRoomFragment(`#k=${encoded.slice(0, 20)}&t=<script>`)
    expect(parsed.key).toBeUndefined()
    expect(parsed.invalidKey).toBe(true)
    expect(parsed.inviteToken).toBeUndefined()
    expect(parseRoomFragment('').invalidKey).toBe(false)
  })

  it('parses bare token fragments', () => {
    expect(parseTokenFragment('#abcdefghijklmnopqrstuv')).toBe('abcdefghijklmnopqrstuv')
    expect(parseTokenFragment('#short')).toBeUndefined()
    expect(parseTokenFragment('#bad token with spaces')).toBeUndefined()
  })
})
