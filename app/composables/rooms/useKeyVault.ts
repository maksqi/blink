/**
 * The room key vault of the signed-in user plus this tab's meeting key (app/lib/e2ee/key-vault.ts), bound to
 * `useAuthState()`. Reads return null during SSR and for signed-out visitors (the tab key works for everyone).
 * `revision` changes on every write, so `computed()`s that read the vault update after a save or a removal.
 *
 * sessionStorage falls back to memory for the life of the page (private modes), so a key created in this tab still
 * reaches `/m/<slug>` when the browser refuses storage.
 */
import { createKeyVault, createTabKeys, type VaultEntry } from '~/lib/e2ee/key-vault'
import { createResilientStorage, type KeyValueStore } from '~/lib/shell/fragment-store'

let tabStorage: KeyValueStore | null = null

function sessionStore(): KeyValueStore | null {
  if (!import.meta.client) return null
  tabStorage ??= createResilientStorage(() => window.sessionStorage)
  return tabStorage
}

function localStore(): Storage | null {
  return import.meta.client ? window.localStorage : null
}

const vault = createKeyVault(localStore)
const tabKeys = createTabKeys(sessionStore)

export function useKeyVault() {
  const user = useAuthState()
  const revision = useState('blinq:key-vault:revision', () => 0)
  const userId = () => (import.meta.client ? (user.value?.id ?? '') : '')
  const touch = () => {
    revision.value++
  }

  return {
    revision,
    get(roomId: string): VaultEntry | null {
      void revision.value
      return vault.get(userId(), roomId)
    },
    findBySlug(slug: string): VaultEntry | null {
      void revision.value
      return vault.findBySlug(userId(), slug)
    },
    save(entry: Omit<VaultEntry, 'savedAt'>): boolean {
      const saved = vault.save(userId(), entry)
      touch()
      return saved
    },
    remove(roomId: string): void {
      vault.remove(userId(), roomId)
      touch()
    },
    tab: tabKeys,
  }
}
