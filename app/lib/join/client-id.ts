/**
 * Per-tab client id (`clientIdSchema`, 16..64 base64url characters), kept in sessionStorage `blinq:clientId`. The join
 * API resumes a participant only for the same session or guest cookie *and* the same client id, so a reload of this
 * tab gets its seat back while a second tab joins as a new participant (docs/ARCHITECTURE.md §6.2).
 */
import { randomBytes, toBase64Url } from '../e2ee/encoding'
import type { StorageGetter } from '../e2ee/key-vault'

export const CLIENT_ID_KEY = 'blinq:clientId'

const CLIENT_ID = /^[A-Za-z0-9_-]{16,64}$/

/** Used when sessionStorage is unusable: stable for the life of the page. */
let memoryId: string | null = null

export function newClientId(): string {
  return toBase64Url(randomBytes(16))
}

export function isClientId(value: unknown): value is string {
  return typeof value === 'string' && CLIENT_ID.test(value)
}

/** Reads this tab's client id, creating it once. Never throws. */
export function tabClientId(storage: StorageGetter, create: () => string = newClientId): string {
  try {
    const store = storage()
    if (store) {
      const existing = store.getItem(CLIENT_ID_KEY)
      if (isClientId(existing)) return existing
      const id = create()
      store.setItem(CLIENT_ID_KEY, id)
      return id
    }
  } catch {
    // Unusable storage: the in-memory id keeps at least this page consistent.
  }
  memoryId ??= create()
  return memoryId
}

/** Test helper: forgets the in-memory fallback. */
export function resetClientIdMemory(): void {
  memoryId = null
}
