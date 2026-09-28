/**
 * Fragment capture (docs/SECURITY.md §3.4). Secret-bearing links (`/m/<slug>#k=...&t=...`, `/invite#<token>`,
 * `/verify-email#<token>`, `/reset-password#<token>`) are moved into sessionStorage under `blinq:fragment:<pathname>`
 * and stripped from the address bar with `history.replaceState`, keeping path and query.
 *
 * The capture runs while this module is evaluated, which is before any plugin's setup. nuxt:router snapshots
 * `window.location` for the initial navigation, so neither the router (`route.hash`, `route.fullPath`) nor any route
 * middleware ever sees the secret. `enforce: 'pre'` makes `$fragment` available to every later plugin.
 *
 * Usage, client side only (in onMounted or behind `import.meta.client`; `/m/**` renders on the client anyway):
 *   const { $fragment } = useNuxtApp()
 *   const room = $fragment.take(`/m/${slug}`) // RoomFragment | null: { key?, inviteToken?, invalidKey }
 *   const token = $fragment.take('/invite') // string | null
 * `take()` returns the value once and forgets it; `peek()` reads it without removing it.
 */
import { captureFragment, createFragmentStore, createResilientStorage } from '~/lib/shell/fragment-store'

const storage = createResilientStorage(() => window.sessionStorage)

try {
  captureFragment({ location: window.location, history: window.history, storage })
} catch {
  // A browser refusing replaceState must not break the app; the page then asks for a working link.
}

export default defineNuxtPlugin({
  name: 'blinq:fragment',
  enforce: 'pre',
  setup() {
    return { provide: { fragment: createFragmentStore(storage) } }
  },
})
