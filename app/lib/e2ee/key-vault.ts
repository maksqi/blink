/**
 * Room key vault (rooms-ui, docs/SECURITY.md §3.1). The only places where the browser keeps the room key K:
 *
 * - localStorage `blinq:keys:<userId>` → `{ [roomId]: { k, slug, keyVersion, savedAt } }`: keys of rooms the signed-in
 *   user owns or co-hosts, so the dashboard and the room page can build host and invite links. Every user has their own
 *   entry, so another account's keys are never read. `useAuth()` removes every `blinq:keys:*` entry on sign-out and
 *   when it notices that the session ended (`clearKeyVault`, app/lib/shell/sign-out.ts).
 * - sessionStorage `blinq:tabkey:<slug>` → `{ k, t? }`: the key (and invite token) of the meeting opened in this tab,
 *   guests included, so a reload or a sign-in round trip still works after the fragment was stripped.
 *
 * Every storage access is wrapped in try/catch (private modes, blocked site data and full quotas throw), and malformed
 * entries are dropped, never half-used. Pure module: storages are passed in, so it runs in plain Vitest.
 */
import { KEY_VAULT_PREFIX, TAB_KEY_PREFIX } from '../shell/sign-out'
import { decodeRoomKey, encodeRoomKey, isValidSlug, type RoomKey } from './keys'

export { KEY_VAULT_PREFIX, TAB_KEY_PREFIX }

/** The subset of the Web Storage API the vault needs. */
export interface KeyStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Returns the storage, or null when it is unavailable. May throw (the vault catches it). */
export type StorageGetter = () => KeyStorage | null | undefined

export interface VaultEntry {
  roomId: string
  slug: string
  key: RoomKey
  keyVersion: number
  /** Epoch ms of the last save. */
  savedAt: number
}

interface StoredVaultEntry {
  k: string
  slug: string
  keyVersion: number
  savedAt: number
}

export interface TabKey {
  key: RoomKey
  inviteToken?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INVITE_TOKEN = /^[A-Za-z0-9_-]{16,128}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function open(getter: StorageGetter): KeyStorage | null {
  try {
    return getter() ?? null
  } catch {
    return null
  }
}

function readJson(getter: StorageGetter, key: string): unknown {
  const storage = open(getter)
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    return raw === null ? null : (JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

function writeJson(getter: StorageGetter, key: string, value: unknown): boolean {
  const storage = open(getter)
  if (!storage) return false
  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function remove(getter: StorageGetter, key: string): void {
  const storage = open(getter)
  if (!storage) return
  try {
    storage.removeItem(key)
  } catch {
    // Nothing to remove from an unusable storage.
  }
}

function decodeKey(value: unknown): RoomKey | null {
  if (typeof value !== 'string') return null
  try {
    return decodeRoomKey(value)
  } catch {
    return null
  }
}

function toEntry(roomId: string, value: unknown): VaultEntry | null {
  if (!UUID.test(roomId) || !isRecord(value)) return null
  const key = decodeKey(value.k)
  const { slug, keyVersion, savedAt } = value
  if (!key || typeof slug !== 'string' || !isValidSlug(slug)) return null
  if (typeof keyVersion !== 'number' || !Number.isInteger(keyVersion) || keyVersion < 1) return null
  return { roomId, slug, key, keyVersion, savedAt: typeof savedAt === 'number' ? savedAt : 0 }
}

export function vaultStorageKey(userId: string): string {
  return KEY_VAULT_PREFIX + userId
}

export function tabKeyStorageKey(slug: string): string {
  return TAB_KEY_PREFIX + slug
}

export interface KeyVault {
  /** Every valid entry of `userId`, by room id. */
  entries(userId: string): Map<string, VaultEntry>
  get(userId: string, roomId: string): VaultEntry | null
  findBySlug(userId: string, slug: string): VaultEntry | null
  /** Stores (or replaces) the key of a room. False when the storage refused it. */
  save(userId: string, entry: Omit<VaultEntry, 'savedAt'>): boolean
  remove(userId: string, roomId: string): void
}

/** The localStorage vault of rooms the user owns or co-hosts, namespaced by user id. */
export function createKeyVault(storage: StorageGetter, now: () => number = Date.now): KeyVault {
  function entries(userId: string): Map<string, VaultEntry> {
    const result = new Map<string, VaultEntry>()
    if (!userId) return result
    const data = readJson(storage, vaultStorageKey(userId))
    if (!isRecord(data)) return result
    for (const [roomId, value] of Object.entries(data)) {
      const entry = toEntry(roomId, value)
      if (entry) result.set(roomId, entry)
    }
    return result
  }

  function persist(userId: string, map: Map<string, VaultEntry>): boolean {
    if (map.size === 0) {
      remove(storage, vaultStorageKey(userId))
      return true
    }
    const data: Record<string, StoredVaultEntry> = {}
    for (const entry of map.values()) {
      data[entry.roomId] = {
        k: encodeRoomKey(entry.key),
        slug: entry.slug,
        keyVersion: entry.keyVersion,
        savedAt: entry.savedAt,
      }
    }
    return writeJson(storage, vaultStorageKey(userId), data)
  }

  return {
    entries,
    get(userId, roomId) {
      return entries(userId).get(roomId) ?? null
    },
    findBySlug(userId, slug) {
      let found: VaultEntry | null = null
      for (const entry of entries(userId).values()) {
        // A slug is unique on the server; keep the newest entry should an old one linger.
        if (entry.slug === slug && (!found || entry.savedAt > found.savedAt)) found = entry
      }
      return found
    },
    save(userId, entry) {
      if (!userId || !toEntry(entry.roomId, { ...entry, k: encodeRoomKey(entry.key) })) return false
      const map = entries(userId)
      map.set(entry.roomId, { ...entry, savedAt: now() })
      return persist(userId, map)
    },
    remove(userId, roomId) {
      const map = entries(userId)
      if (map.delete(roomId)) persist(userId, map)
    },
  }
}

export interface TabKeys {
  get(slug: string): TabKey | null
  save(slug: string, value: TabKey): boolean
  remove(slug: string): void
}

/** sessionStorage keys of the meeting opened in this tab (guests too). */
export function createTabKeys(storage: StorageGetter): TabKeys {
  return {
    get(slug) {
      if (!isValidSlug(slug)) return null
      const data = readJson(storage, tabKeyStorageKey(slug))
      if (!isRecord(data)) return null
      const key = decodeKey(data.k)
      if (!key) {
        remove(storage, tabKeyStorageKey(slug))
        return null
      }
      const t = data.t
      return typeof t === 'string' && INVITE_TOKEN.test(t) ? { key, inviteToken: t } : { key }
    },
    save(slug, value) {
      if (!isValidSlug(slug)) return false
      const data: { k: string; t?: string } = { k: encodeRoomKey(value.key) }
      if (value.inviteToken && INVITE_TOKEN.test(value.inviteToken)) data.t = value.inviteToken
      return writeJson(storage, tabKeyStorageKey(slug), data)
    },
    remove(slug) {
      remove(storage, tabKeyStorageKey(slug))
    },
  }
}
