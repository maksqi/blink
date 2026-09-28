/**
 * In-process cache of validated sessions (server-core). Entries live at most `ttlMs` (30 s) from the moment they were
 * loaded from the database: hits never extend them, so revocations by other processes (the CLI) apply within 30 s.
 * Revocations in this process evict immediately (`delete`, `deleteUser`).
 */
export interface CachedSession {
  session: { id: string; userId: string }
}

export interface SessionCache<T extends CachedSession> {
  get(id: string, now: Date): T | undefined
  /** Stores a value freshly loaded from the database. */
  set(id: string, value: T, now: Date): void
  /** Replaces the value (e.g. after touching `last_seen_at`) without extending its lifetime. */
  update(id: string, value: T): void
  delete(id: string): void
  deleteUser(userId: string): void
  clear(): void
  readonly size: number
}

export function createSessionCache<T extends CachedSession>(options: { ttlMs: number; maxEntries?: number }): SessionCache<T> {
  const { ttlMs, maxEntries = 10_000 } = options
  const entries = new Map<string, { value: T; loadedAt: number }>()

  return {
    get(id, now) {
      const entry = entries.get(id)
      if (!entry) return undefined
      if (now.getTime() - entry.loadedAt >= ttlMs) {
        entries.delete(id)
        return undefined
      }
      return entry.value
    },
    set(id, value, now) {
      entries.delete(id)
      while (entries.size >= maxEntries) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }
      entries.set(id, { value, loadedAt: now.getTime() })
    },
    update(id, value) {
      const entry = entries.get(id)
      if (entry) entry.value = value
    },
    delete(id) {
      entries.delete(id)
    },
    deleteUser(userId) {
      for (const [id, entry] of entries) if (entry.value.session.userId === userId) entries.delete(id)
    },
    clear() {
      entries.clear()
    },
    get size() {
      return entries.size
    },
  }
}
