/**
 * Capture of secret-bearing URL fragments (docs/SECURITY.md §3.4).
 *
 * Links keep every secret in the fragment, which browsers never send to servers:
 *   /m/<slug>#k=<roomKey>&t=<inviteToken>   /invite#<token>   /verify-email#<token>   /reset-password#<token>
 *
 * On page load `app/plugins/00.fragment.client.ts` calls `captureFragment()`: the fragment is validated with the e2ee
 * parsers, kept in sessionStorage under `blinq:fragment:<pathname>` and stripped from the address bar with
 * `history.replaceState`, before the router or any route middleware reads the URL. Pages read the value once with
 * `useNuxtApp().$fragment.take(pathname)`.
 *
 * Pure module: every browser object is passed in, so it runs in plain Vitest.
 */
import { parseRoomFragment, parseTokenFragment, type RoomFragment } from '../e2ee/fragment'
import { decodeRoomKey, encodeRoomKey } from '../e2ee/keys'

export const FRAGMENT_STORAGE_PREFIX = 'blinq:fragment:'

/** Pages whose fragment is a bare token: account invite, email verification, password reset. */
export const TOKEN_PATHS = ['/invite', '/verify-email', '/reset-password'] as const
export type TokenPath = (typeof TOKEN_PATHS)[number]
/** Meeting pages, `/m/<slug>`. Their fragment carries the room key `k` and an optional invite token `t`. */
export type RoomPath = `/m/${string}`
export type FragmentKind = 'room' | 'token'

const ROOM_PATH = /^\/m\/[^/]+$/

/** The subset of the Web Storage API the store needs. */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface CaptureEnv {
  location: Pick<Location, 'pathname' | 'search' | 'hash'>
  history: Pick<History, 'state' | 'replaceState'>
  storage: KeyValueStore
}

export interface CaptureResult {
  pathname: string
  kind: FragmentKind
  /** False when the fragment was unusable: it was stripped and any older capture for the page was dropped. */
  stored: boolean
}

/** Read-once access to captured fragments. Values are typed by the page they belong to. */
export interface FragmentStore {
  /** Returns the value captured for `pathname` and forgets it. `null` when there is none. */
  take(pathname: RoomPath): RoomFragment | null
  take(pathname: TokenPath): string | null
  take(pathname: string): RoomFragment | string | null
  /** Like `take()`, but keeps the value. */
  peek(pathname: RoomPath): RoomFragment | null
  peek(pathname: TokenPath): string | null
  peek(pathname: string): RoomFragment | string | null
}

type StoredFragment = { kind: 'room'; k?: string; t?: string; invalidKey: boolean } | { kind: 'token'; token: string }

/** `/invite/` and `/invite` share one entry. */
export function normalizePathname(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

export function fragmentKind(pathname: string): FragmentKind | null {
  const path = normalizePathname(pathname)
  if (ROOM_PATH.test(path)) return 'room'
  return (TOKEN_PATHS as readonly string[]).includes(path) ? 'token' : null
}

export function fragmentStorageKey(pathname: string): string {
  return FRAGMENT_STORAGE_PREFIX + normalizePathname(pathname)
}

function toRecord(kind: FragmentKind, hash: string): StoredFragment | null {
  if (kind === 'token') {
    const token = parseTokenFragment(hash)
    return token ? { kind, token } : null
  }
  const parsed = parseRoomFragment(hash)
  if (!parsed.key && !parsed.inviteToken && !parsed.invalidKey) return null
  return {
    kind,
    ...(parsed.key ? { k: encodeRoomKey(parsed.key) } : {}),
    ...(parsed.inviteToken ? { t: parsed.inviteToken } : {}),
    invalidKey: parsed.invalidKey,
  }
}

/**
 * Moves the fragment of the current URL into `storage` and strips it from the address bar, keeping path and query.
 * Only pages that take secrets are touched; anchors elsewhere stay as they are. A new fragment always replaces an
 * older capture for the same page, even when it is unusable, so a stale secret is never picked up by mistake.
 */
export function captureFragment({ location, history, storage }: CaptureEnv): CaptureResult | null {
  const { hash, pathname, search } = location
  if (!hash) return null
  const kind = fragmentKind(pathname)
  if (!kind) return null

  const record = toRecord(kind, hash)
  const key = fragmentStorageKey(pathname)
  let stored = false
  try {
    if (record) {
      storage.setItem(key, JSON.stringify(record))
      stored = true
    } else {
      storage.removeItem(key)
    }
  } catch {
    // The page then asks for a working link; the secret must leave the address bar either way.
  }
  // Same history entry, so no extra "back" step, and the secret is gone from the address bar and history.
  history.replaceState(history.state, '', pathname + search)
  return { pathname: normalizePathname(pathname), kind, stored }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function decodeRecord(raw: string, kind: FragmentKind): RoomFragment | string | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(data) || data.kind !== kind) return null

  if (kind === 'token') return typeof data.token === 'string' ? (parseTokenFragment(data.token) ?? null) : null

  const result: RoomFragment = { invalidKey: data.invalidKey === true }
  if (typeof data.k === 'string') {
    try {
      result.key = decodeRoomKey(data.k)
    } catch {
      result.invalidKey = true
    }
  }
  if (typeof data.t === 'string' && parseTokenFragment(data.t)) result.inviteToken = data.t
  return result.key || result.inviteToken || result.invalidKey ? result : null
}

export function createFragmentStore(storage: KeyValueStore): FragmentStore {
  function read(pathname: string): RoomFragment | string | null {
    const kind = fragmentKind(pathname)
    if (!kind) return null
    const key = fragmentStorageKey(pathname)
    const raw = storage.getItem(key)
    if (raw === null) return null
    const value = decodeRecord(raw, kind)
    if (value === null) storage.removeItem(key) // corrupt or foreign data is dropped, never half-used
    return value
  }

  function take(pathname: string): RoomFragment | string | null {
    const value = read(pathname)
    if (value !== null) storage.removeItem(fragmentStorageKey(pathname))
    return value
  }

  return { take, peek: read } as FragmentStore
}

/**
 * sessionStorage when it is usable, otherwise an in-memory map for the life of the page: private modes and
 * sandboxed frames can throw on access, and a captured key must still reach the page that asked for it.
 */
export function createResilientStorage(getPrimary: () => KeyValueStore | null | undefined): KeyValueStore {
  const memory = new Map<string, string>()
  const primary = (): KeyValueStore | null => {
    try {
      return getPrimary() ?? null
    } catch {
      return null
    }
  }

  return {
    getItem(key) {
      const local = memory.get(key)
      if (local !== undefined) return local
      try {
        return primary()?.getItem(key) ?? null
      } catch {
        return null
      }
    },
    setItem(key, value) {
      try {
        const store = primary()
        if (store) {
          store.setItem(key, value)
          memory.delete(key)
          return
        }
      } catch {
        // Quota or security error: keep the value in memory instead.
      }
      memory.set(key, value)
    },
    removeItem(key) {
      memory.delete(key)
      try {
        primary()?.removeItem(key)
      } catch {
        // Nothing to remove from an unusable storage.
      }
    },
  }
}
