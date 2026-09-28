/**
 * `guest` route middleware: pages for signed-out visitors (sign in, register, forgot password). Signed-in users
 * continue to `?next` when it is a safe relative path, otherwise to `/dashboard` (or to `/change-password` first).
 *
 *   definePageMeta({ middleware: 'guest' })
 */
import { safeRedirectPath } from '~/lib/shell/redirect'

export default defineNuxtRouteMiddleware((to) => {
  const user = useAuthState()
  if (!user.value) return
  if (user.value.mustChangePassword) return navigateTo('/change-password')
  return navigateTo(safeRedirectPath(to.query.next))
})
