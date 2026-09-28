/**
 * `auth` route middleware: signed-in users only. Anonymous visitors go to `/login?next=<path>` (the path only, never
 * the query or a fragment); accounts that must change their password go to `/change-password`.
 *
 *   definePageMeta({ middleware: 'auth' })
 */
import { signInLocation } from '~/composables/useAuth'

export default defineNuxtRouteMiddleware((to) => {
  const user = useAuthState()
  if (!user.value) return navigateTo(signInLocation(to.path))
  if (user.value.mustChangePassword && to.path !== '/change-password') return navigateTo('/change-password')
})
