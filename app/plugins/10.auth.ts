/**
 * Loads the session into `useAuthState()` once, before the first navigation runs route middleware (auth).
 *
 * - SSR: `GET /api/auth/me` through `useApi()`, which forwards the request's cookies; the result reaches the client in
 *   the payload, so hydration does not fetch again.
 * - Client-only routes (`/m/**`) and a failed SSR fetch: the client fetches instead.
 * - When the tab becomes visible again (at most once a minute) the session is re-checked, so a session revoked on
 *   another device signs this one out too (key vault cleared) and protected pages go to `/login`.
 */
import { routeNeedsSession, signInLocation, useAuth } from '~/composables/useAuth'

const RECHECK_INTERVAL_MS = 60_000

export default defineNuxtPlugin({
  name: 'blinq:auth',
  async setup() {
    const auth = useAuth()
    if (!auth.loaded.value) {
      try {
        await auth.refresh()
      } catch {
        // Offline or a server error: render signed out; the client tries again (loaded stays false).
      }
    }
    if (!import.meta.client) return

    const router = useRouter()
    let checkedAt = Date.now()
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - checkedAt < RECHECK_INTERVAL_MS) return
      checkedAt = Date.now()
      const hadUser = auth.user.value !== null
      auth
        .refresh()
        .then(async (user) => {
          const route = router.currentRoute.value
          if (hadUser && !user && routeNeedsSession(route.meta.middleware))
            await router.push(signInLocation(route.path))
        })
        .catch(() => {})
    })
  },
})
