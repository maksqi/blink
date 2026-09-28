/**
 * Global: while the signed-in account must change its password (bootstrap admin, admin-created or admin-reset
 * accounts), every page leads to `/change-password`. The API enforces the same rule with 403
 * `AUTH_PASSWORD_CHANGE_REQUIRED`.
 */
export default defineNuxtRouteMiddleware((to) => {
  const user = useAuthState()
  if (user.value?.mustChangePassword && to.path !== '/change-password') return navigateTo('/change-password')
})
