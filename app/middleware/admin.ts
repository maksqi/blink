/**
 * `admin` route middleware: admins only (includes the `auth` rules). Anonymous visitors go to `/login?next=<path>`,
 * pending password changes to `/change-password`, everyone else gets the 403 page. The API authorizes on its own; this
 * only keeps people from pages they cannot use.
 *
 *   definePageMeta({ layout: 'admin', middleware: 'admin' })
 */
import { signInLocation } from '~/composables/useAuth'

export default defineNuxtRouteMiddleware((to) => {
  // The server already rendered the 403 page for this request. Raising it again while that page hydrates would only
  // report the same error twice (Nuxt logs [NUXT_E1005], F-051); the error page stays up either way.
  if (import.meta.client && useNuxtApp().isHydrating && useError().value) return
  const user = useAuthState()
  if (!user.value) return navigateTo(signInLocation(to.path))
  if (user.value.mustChangePassword) return navigateTo('/change-password')
  if (user.value.role !== 'admin') return abortNavigation(createError({ statusCode: 403, statusMessage: 'Forbidden' }))
})
