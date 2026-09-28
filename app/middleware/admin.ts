/**
 * `admin` route middleware: admins only (includes the `auth` rules). Anonymous visitors go to `/login?next=<path>`,
 * pending password changes to `/change-password`, everyone else gets the 403 page. The API authorizes on its own; this
 * only keeps people from pages they cannot use.
 *
 *   definePageMeta({ layout: 'admin', middleware: 'admin' })
 */
import { signInLocation } from '~/composables/useAuth'

export default defineNuxtRouteMiddleware((to) => {
  const user = useAuthState()
  if (!user.value) return navigateTo(signInLocation(to.path))
  if (user.value.mustChangePassword) return navigateTo('/change-password')
  if (user.value.role !== 'admin') return abortNavigation(createError({ statusCode: 403, statusMessage: 'Forbidden' }))
})
