/**
 * Sign-out as run by the shell (user menu and mobile menu). The server call can fail (offline, or not implemented
 * yet); the user is told, and this device is signed out locally anyway, as they asked.
 */
import { FRAGMENT_STORAGE_PREFIX } from './fragment-store'

/** localStorage prefix of the room key vault (`blinq:keys:<userId>`), cleared on sign-out (docs/SECURITY.md §3.1). */
export const KEY_VAULT_PREFIX = 'blinq:keys:'
/** sessionStorage prefix of the per-tab meeting keys (`blinq:tabkey:<slug>`), also cleared on sign-out. */
export const TAB_KEY_PREFIX = 'blinq:tabkey:'

export interface KeyListStorage {
  readonly length: number
  key(index: number): string | null
  removeItem(key: string): void
}

export interface SignOutDeps {
  /** POST /api/auth/logout. */
  logout: () => Promise<unknown>
  /** Resets the shared auth state (`useAuthState()`). */
  clearUser: () => void
  navigate: () => unknown
  /** Called when the server did not confirm the sign-out. */
  onError: (error: unknown) => void
  vault?: KeyListStorage | null
  /** sessionStorage, for the per-tab meeting keys. */
  tabKeys?: KeyListStorage | null
}

function isUnauthenticated(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 401
}

function clearPrefix(storage: KeyListStorage | null | undefined, prefix: string): void {
  if (!storage) return
  try {
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index)
      if (key?.startsWith(prefix)) storage.removeItem(key)
    }
  } catch {
    // Unusable storage holds no keys.
  }
}

/** Removes every key-vault entry. Storage access can throw in private modes; there is nothing to clear then. */
export function clearKeyVault(storage: KeyListStorage | null | undefined): void {
  clearPrefix(storage, KEY_VAULT_PREFIX)
}

/**
 * Removes every per-tab meeting key (and the invite token stored with it), plus link fragments captured on load that
 * no page has taken yet (`blinq:fragment:<path>`, app/lib/shell/fragment-store.ts): both can hold a room key.
 */
export function clearTabKeys(storage: KeyListStorage | null | undefined): void {
  clearPrefix(storage, TAB_KEY_PREFIX)
  clearPrefix(storage, FRAGMENT_STORAGE_PREFIX)
}

/**
 * What a session check must forget on this device (docs/SECURITY.md §3.1, F-029):
 * - `all` (vault, tab keys and captured fragments) when the signed-in user is gone or another user signed in;
 * - `vault` when nobody is signed in: vault entries exist only for signed-in users, so any left over belong to a session
 *   that expired or was revoked while this device was away; guests keep their tab keys, which reloads need;
 * - `none` while the same user stays signed in.
 */
export function keysToForget(previousUserId: string | null, nextUserId: string | null): 'all' | 'vault' | 'none' {
  if (previousUserId !== null && previousUserId !== nextUserId) return 'all'
  return nextUserId === null ? 'vault' : 'none'
}

export async function signOut(deps: SignOutDeps): Promise<void> {
  try {
    await deps.logout()
  } catch (error) {
    // 401: the session had already ended, which is what the user wants.
    if (!isUnauthenticated(error)) deps.onError(error)
  }
  clearKeyVault(deps.vault)
  clearTabKeys(deps.tabKeys)
  deps.clearUser()
  await deps.navigate()
}
