import type { AuthUser } from '#shared/schemas/auth'

/**
 * Shared, SSR-safe auth state (orchestrator-owned contract).
 * Written by the auth workstream's `useAuth()` (login, logout, `GET /api/auth/me`); read by the shell (header, nav,
 * route guards) and features. `null` means signed out.
 */
export function useAuthState() {
  return useState<AuthUser | null>('blinq:auth:user', () => null)
}
