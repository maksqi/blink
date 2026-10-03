/**
 * Where the `/m/<slug>` page gets the room key K and the invite token from (rooms-ui, docs/SECURITY.md §3.1, §3.4):
 *
 * 1. the link fragment (`#k=…&t=…`, captured and stripped by app/plugins/00.fragment.client.ts) — a fresh link wins;
 * 2. this tab's key (`blinq:tabkey:<slug>`), so reloads and sign-in round trips keep working;
 * 3. the signed-in user's key vault (rooms they own or co-host).
 *
 * A key that is present but damaged in the link is reported as such, even when another source has one: the person
 * opened that link and should learn that it is broken.
 */
import type { RoomFragment } from '../e2ee/fragment'
import type { TabKey, VaultEntry } from '../e2ee/key-vault'
import { encodeRoomKey, type RoomKey } from '../e2ee/keys'

export type KeySource = 'fragment' | 'tab' | 'vault'

export type ResolvedRoomKey =
  | { status: 'found'; key: RoomKey; inviteToken?: string; source: KeySource }
  | { status: 'missing' }
  | { status: 'invalid' }

export interface KeySources {
  fragment: RoomFragment | null
  tab: TabKey | null
  vault: VaultEntry | null
}

export function resolveRoomKey({ fragment, tab, vault }: KeySources): ResolvedRoomKey {
  if (fragment?.invalidKey) return { status: 'invalid' }
  if (fragment?.key) {
    // A new link decides the invite too; the tab's token only belongs to the same key.
    const sameKey = tab ? encodeRoomKey(tab.key) === encodeRoomKey(fragment.key) : false
    const inviteToken = fragment.inviteToken ?? (sameKey ? tab?.inviteToken : undefined)
    return { status: 'found', key: fragment.key, source: 'fragment', ...(inviteToken ? { inviteToken } : {}) }
  }
  const inviteToken = fragment?.inviteToken ?? tab?.inviteToken
  const withInvite = inviteToken ? { inviteToken } : {}
  if (tab) return { status: 'found', key: tab.key, source: 'tab', ...withInvite }
  if (vault) return { status: 'found', key: vault.key, source: 'vault', ...withInvite }
  return { status: 'missing' }
}
