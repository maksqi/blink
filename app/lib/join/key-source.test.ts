import { describe, expect, it } from 'vitest'
import type { VaultEntry } from '../e2ee/key-vault'
import { encodeRoomKey, generateRoomKey } from '../e2ee/keys'
import { resolveRoomKey } from './key-source'

const LINK_KEY = generateRoomKey()
const TAB_KEY = generateRoomKey()
const VAULT_KEY = generateRoomKey()
const VAULT: VaultEntry = {
  roomId: '0190a1b2-c3d4-7e5f-8a9b-00000000000a',
  slug: 'abc-defg-hjk',
  key: VAULT_KEY,
  keyVersion: 1,
  savedAt: 1,
}
const T_LINK = 'link-invite-token-0123456789'
const T_TAB = 'tab-invite-token-0123456789'

function keyOf(result: ReturnType<typeof resolveRoomKey>) {
  return result.status === 'found' ? encodeRoomKey(result.key) : null
}

describe('resolveRoomKey', () => {
  it('prefers the link, then the tab, then the vault', () => {
    const all = {
      fragment: { key: LINK_KEY, invalidKey: false },
      tab: { key: TAB_KEY },
      vault: VAULT,
    }
    expect(keyOf(resolveRoomKey(all))).toBe(encodeRoomKey(LINK_KEY))
    expect(resolveRoomKey(all)).toMatchObject({ source: 'fragment' })
    expect(keyOf(resolveRoomKey({ ...all, fragment: null }))).toBe(encodeRoomKey(TAB_KEY))
    expect(resolveRoomKey({ ...all, fragment: null })).toMatchObject({ source: 'tab' })
    expect(keyOf(resolveRoomKey({ fragment: null, tab: null, vault: VAULT }))).toBe(encodeRoomKey(VAULT_KEY))
    expect(resolveRoomKey({ fragment: null, tab: null, vault: VAULT })).toMatchObject({ source: 'vault' })
  })

  it('reports a missing key', () => {
    expect(resolveRoomKey({ fragment: null, tab: null, vault: null })).toEqual({ status: 'missing' })
    // An invite token alone does not open a meeting.
    expect(resolveRoomKey({ fragment: { inviteToken: T_LINK, invalidKey: false }, tab: null, vault: null })).toEqual({
      status: 'missing',
    })
  })

  it('reports a damaged key in the link even when another source has one', () => {
    expect(resolveRoomKey({ fragment: { invalidKey: true }, tab: { key: TAB_KEY }, vault: VAULT })).toEqual({
      status: 'invalid',
    })
  })

  it('takes the invite token from the link, else from the tab', () => {
    const fromLink = resolveRoomKey({
      fragment: { key: LINK_KEY, inviteToken: T_LINK, invalidKey: false },
      tab: { key: LINK_KEY, inviteToken: T_TAB },
      vault: null,
    })
    expect(fromLink).toMatchObject({ inviteToken: T_LINK })
    const reloaded = resolveRoomKey({ fragment: null, tab: { key: TAB_KEY, inviteToken: T_TAB }, vault: null })
    expect(reloaded).toMatchObject({ inviteToken: T_TAB, source: 'tab' })
    // The link without `t` but with the tab's key keeps the tab's invite (the same link reopened).
    const same = resolveRoomKey({
      fragment: { key: LINK_KEY, invalidKey: false },
      tab: { key: LINK_KEY, inviteToken: T_TAB },
      vault: null,
    })
    expect(same).toMatchObject({ inviteToken: T_TAB })
  })

  it('never pairs an invite with another key', () => {
    const result = resolveRoomKey({
      fragment: { key: LINK_KEY, invalidKey: false },
      tab: { key: TAB_KEY, inviteToken: T_TAB },
      vault: null,
    })
    expect(result.status).toBe('found')
    expect(result).not.toHaveProperty('inviteToken')
    // A link carrying only an invite token pairs it with the tab or vault key.
    expect(
      resolveRoomKey({ fragment: { inviteToken: T_LINK, invalidKey: false }, tab: null, vault: VAULT }),
    ).toMatchObject({ inviteToken: T_LINK, source: 'vault' })
  })
})
