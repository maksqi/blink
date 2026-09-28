/**
 * Secret-bearing links keep every secret in the URL fragment, which browsers never send to servers.
 *   room:   /m/<slug>#k=<roomKey>            invite: /m/<slug>#k=<roomKey>&t=<inviteToken>
 *   account/verify/reset: /invite#<token>   /verify-email#<token>   /reset-password#<token>
 */
import { decodeRoomKey, encodeRoomKey, type RoomKey } from './keys'

export interface RoomFragment {
  key?: RoomKey
  inviteToken?: string
  /** True when a `k` value was present but invalid (e.g. truncated by a messenger). */
  invalidKey: boolean
}

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/

export function parseRoomFragment(hash: string): RoomFragment {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const result: RoomFragment = { invalidKey: false }
  const k = params.get('k')
  if (k !== null) {
    try {
      result.key = decodeRoomKey(k)
    } catch {
      result.invalidKey = true
    }
  }
  const t = params.get('t')
  if (t !== null && TOKEN.test(t)) result.inviteToken = t
  return result
}

export function buildRoomLink(publicUrl: string, slug: string, key: RoomKey, inviteToken?: string): string {
  const fragment = new URLSearchParams({ k: encodeRoomKey(key) })
  if (inviteToken) fragment.set('t', inviteToken)
  return `${publicUrl.replace(/\/$/, '')}/m/${slug}#${fragment.toString()}`
}

/** Bare-token fragments used by account invite, verification and reset links. */
export function parseTokenFragment(hash: string): string | undefined {
  const value = hash.startsWith('#') ? hash.slice(1) : hash
  return TOKEN.test(value) ? value : undefined
}
