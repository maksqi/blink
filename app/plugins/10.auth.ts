/**
 * Loads the session into `useAuthState()` once, before the first navigation runs route middleware (auth).
 *
 * - SSR: `GET /api/auth/me` through `useApi()`, which forwards the request's cookies; the result reaches the client in
 *   the payload, so hydration does not fetch again.
 * - Client-only routes (`/m/**`) and a failed SSR fetch: the client fetches instead.
 * - When the tab becomes visible again (at most once a minute) the session is re-checked, so a session revoked on
 *   another device signs this one out too (key vault cleared) and protected pages go to `/login`.
 * - Nobody signed in at start-up: key-vault entries of an expired session are dropped (docs/SECURITY.md §3.1).
 * - `blinq:session-lost` (an API call answered 401 `UNAUTHENTICATED`) signs this device out the same way.
 */
import { routeNeedsSession, signInLocation, useAuth } from '~/composables/useAuth'

declare module '#app' {
  interface RuntimeNuxtHooks {
    /** An API request answered 401 `UNAUTHENTICATED`: the session of this browser is gone. */
    'blinq:session-lost': () => void
  }
}

const RECHECK_INTERVAL_MS = 60_000

export default defineNuxtPlugin({
  name: 'blinq:auth',
  async setup(nuxtApp) {
    const auth = useAuth()
    if (!auth.loaded.value) {
      try {
        await auth.refresh()
      } catch {
        // Offline or a server error: render signed out; the client tries again (loaded stays false).
      }
    }
    if (!import.meta.client) return

    auth.forgetOrphanedKeys()

    const router = useRouter()
    /** A protected page cannot stay open once the session is gone. */
    async function leaveIfProtected(hadUser: boolean) {
      const route = router.currentRoute.value
      if (hadUser && !auth.user.value && routeNeedsSession(route.meta.middleware))
        await router.push(signInLocation(route.path))
    }

    nuxtApp.hook('blinq:session-lost', async () => {
      const hadUser = auth.user.value !== null
      auth.sessionLost()
      await leaveIfProtected(hadUser)
    })

    let checkedAt = Date.now()
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - checkedAt < RECHECK_INTERVAL_MS) return
      checkedAt = Date.now()
      const hadUser = auth.user.value !== null
      auth
        .refresh()
        .then(() => leaveIfProtected(hadUser))
        .catch(() => {})
    })
  },
})
