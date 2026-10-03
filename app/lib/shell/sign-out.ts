/**
 * Sign-out as run by the shell (user menu and mobile menu). The server call can fail (offline, or not implemented
 * yet); the user is told, and this device is signed out locally anyway, as they asked.
 */
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

/** Removes every per-tab meeting key (and the invite token stored with it). */
export function clearTabKeys(storage: KeyListStorage | null | undefined): void {
  clearPrefix(storage, TAB_KEY_PREFIX)
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
