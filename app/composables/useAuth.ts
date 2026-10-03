/**
 * Client auth (auth workstream). Every call writes the shared `useAuthState()`, which the shell and route middleware
 * read. `app/plugins/10.auth.ts` loads the session once at startup (during SSR with the request's cookies).
 *
 *   const { user, login, logout } = useAuth()
 *   const signedIn = await login({ email, password })
 *
 * - `refresh()`: `GET /api/auth/me`; a session that disappeared (revoked elsewhere, expired) counts as a sign-out.
 * - `logout()` and a detected session loss clear every localStorage key starting with `blinq:keys:` (the room key
 *   vault of `rooms-ui`) (decision). So does any session check that finds nobody signed in: vault entries left behind
 *   by an expired session are dropped on the next page load (`forgetOrphanedKeys()`, docs/SECURITY.md §3.1).
 * - Errors are `ApiError`s from `useApi()`; `authErrorText(error)` and `apiFieldErrors(error)` turn them into copy.
 */
import type { RouteLocationRaw } from 'vue-router'
import type { AuthUser, InvitePreview, MeResponse, SessionInfo } from '#shared/schemas/auth'
import type { PublicConfig } from '#shared/schemas/settings'
import { COMMON_ERRORS, errorMessage } from '#shared/utils/error-codes'
import { isSafeRedirectPath } from '~/lib/shell/redirect'
import {
  clearKeyVault,
  clearTabKeys,
  keysToForget,
  signOut as runSignOut,
  type KeyListStorage,
} from '~/lib/shell/sign-out'
import { ApiError } from './useApi'

export type RegisterResult = { user: AuthUser } | { verificationRequired: true }

function browserStorage(): KeyListStorage | null {
  if (!import.meta.client) return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function tabStorage(): KeyListStorage | null {
  if (!import.meta.client) return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/** Forgets every room key on this device: the vault and the keys of meetings opened in this tab. */
function clearRoomKeys(): void {
  clearKeyVault(browserStorage())
  clearTabKeys(tabStorage())
}

/** Applies `keysToForget()` after a session check. */
function forgetKeysAfterCheck(previousUserId: string | null, nextUserId: string | null): void {
  const forget = keysToForget(previousUserId, nextUserId)
  if (forget === 'all') clearRoomKeys()
  else if (forget === 'vault') clearKeyVault(browserStorage())
}

/** `/login`, remembering where to come back to (relative paths only, docs/SECURITY.md §3.4). */
export function signInLocation(returnTo?: string): RouteLocationRaw {
  const next =
    returnTo && returnTo !== '/' && returnTo !== '/login' && isSafeRedirectPath(returnTo) ? returnTo : undefined
  return next ? { path: '/login', query: { next } } : { path: '/login' }
}

/**
 * `GET /api/config` for the auth pages (registration mode, allowed domains, SMTP): fetched during SSR, shared key.
 * Await it in `<script setup>`: `const { data: config } = await useAuthPageConfig()`.
 */
export function useAuthPageConfig() {
  const api = useApi()
  return useAsyncData('blinq:public-config', () => api<PublicConfig>('/api/config'))
}

/** Whether a page is only for signed-in users (its middleware says so). */
export function routeNeedsSession(middleware: unknown): boolean {
  const list = Array.isArray(middleware) ? middleware : [middleware]
  return list.some((entry) => entry === 'auth' || entry === 'admin')
}

export function useAuth() {
  const user = useAuthState()
  const loaded = useState<boolean>('blinq:auth:loaded', () => false)
  const api = useApi()

  function setUser(next: AuthUser | null): AuthUser | null {
    user.value = next
    loaded.value = true
    return next
  }

  /** This device is signed out (the server says so): forget the user and the room keys. */
  function forgetSession(): void {
    clearRoomKeys()
    user.value = null
  }

  /**
   * An API call answered 401 `UNAUTHENTICATED`: a signed-in user's session ended (expired or revoked), so this device
   * forgets the user and every room key; for a visitor who was never signed in only stray vault entries go.
   */
  function sessionLost(): void {
    forgetKeysAfterCheck(user.value?.id ?? null, null)
    user.value = null
  }

  /**
   * Client start-up: the session was loaded during SSR, so `refresh()` did not run in this browser. When nobody is
   * signed in, vault entries of an earlier, expired session are dropped now.
   */
  function forgetOrphanedKeys(): void {
    if (loaded.value) forgetKeysAfterCheck(null, user.value?.id ?? null)
  }

  async function refresh(): Promise<AuthUser | null> {
    const previous = user.value
    const { user: next } = await api<MeResponse>('/api/auth/me')
    forgetKeysAfterCheck(previous?.id ?? null, next?.id ?? null)
    return setUser(next)
  }

  async function login(input: { email: string; password: string }): Promise<AuthUser> {
    const res = await api<{ user: AuthUser }>('/api/auth/login', { method: 'POST', body: input })
    setUser(res.user)
    return res.user
  }

  /** Signs out on the server and on this device. `redirect: false` stays on the page. */
  async function logout(
    options: { redirect?: string | false; onError?: (error: unknown) => void } = {},
  ): Promise<void> {
    await runSignOut({
      logout: () => api('/api/auth/logout', { method: 'POST' }),
      clearUser: () => {
        user.value = null
      },
      navigate: () => (options.redirect === false ? undefined : navigateTo(options.redirect ?? '/login')),
      onError: options.onError ?? (() => {}),
      vault: browserStorage(),
      tabKeys: tabStorage(),
    })
  }

  async function register(input: { email: string; displayName: string; password: string }): Promise<RegisterResult> {
    const res = await api<RegisterResult>('/api/auth/register', { method: 'POST', body: input })
    if ('user' in res) setUser(res.user)
    return res
  }

  async function changePassword(input: { currentPassword: string; newPassword: string }): Promise<AuthUser> {
    const res = await api<{ user: AuthUser }>('/api/auth/password', { method: 'POST', body: input })
    setUser(res.user)
    return res.user
  }

  async function updateProfile(input: { displayName: string }): Promise<AuthUser> {
    const res = await api<{ user: AuthUser }>('/api/me', { method: 'PATCH', body: input })
    setUser(res.user)
    return res.user
  }

  function previewInvite(token: string): Promise<InvitePreview> {
    return api<InvitePreview>('/api/auth/invites/preview', { method: 'POST', body: { token } })
  }

  async function acceptInvite(input: {
    token: string
    email?: string
    displayName: string
    password: string
  }): Promise<AuthUser> {
    const res = await api<{ user: AuthUser }>('/api/auth/invites/accept', { method: 'POST', body: input })
    setUser(res.user)
    return res.user
  }

  async function verifyEmail(token: string): Promise<void> {
    await api('/api/auth/verify-email', { method: 'POST', body: { token } })
    if (user.value) await refresh().catch(() => {})
  }

  async function requestPasswordReset(email: string): Promise<void> {
    await api('/api/auth/password-reset/request', { method: 'POST', body: { email } })
  }

  /** Every session of the account ends on the server, this one included. */
  async function confirmPasswordReset(input: { token: string; newPassword: string }): Promise<void> {
    await api('/api/auth/password-reset/confirm', { method: 'POST', body: input })
    if (user.value) forgetSession()
  }

  async function listSessions(): Promise<SessionInfo[]> {
    return (await api<{ items: SessionInfo[] }>('/api/auth/sessions')).items
  }

  async function revokeSession(session: Pick<SessionInfo, 'id' | 'current'>): Promise<void> {
    await api(`/api/auth/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' })
    if (session.current) {
      forgetSession()
      await navigateTo('/login')
    }
  }

  return {
    user,
    loaded,
    refresh,
    forgetSession,
    sessionLost,
    forgetOrphanedKeys,
    login,
    logout,
    register,
    changePassword,
    updateProfile,
    previewInvite,
    acceptInvite,
    verifyEmail,
    requestPasswordReset,
    confirmPasswordReset,
    listSessions,
    revokeSession,
  }
}

// ---- Error copy ---------------------------------------------------------------------------------------------------

function retryText(seconds: number): string {
  if (seconds < 60) return `Too many attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`
  const minutes = Math.ceil(seconds / 60)
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
}

const WEAK_PASSWORD_TEXT: Record<string, string> = {
  common: 'This password is too common or too easy to guess. Choose a longer, less predictable one.',
  same_as_current: 'Choose a new password that differs from your current one.',
  too_short: 'Use at least 12 characters.',
  too_long: 'Use at most 256 characters.',
}

/** The copy for `AUTH_PASSWORD_WEAK`, or null for other errors. */
export function weakPasswordText(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== 'AUTH_PASSWORD_WEAK') return null
  const reason = (error.details as { reason?: unknown } | undefined)?.reason
  return (typeof reason === 'string' && WEAK_PASSWORD_TEXT[reason]) || errorMessage('AUTH_PASSWORD_WEAK')
}

/** One English sentence for a failed request, from its stable error code (never server text). */
export function authErrorText(error: unknown): string {
  if (!(error instanceof ApiError)) return COMMON_ERRORS.INTERNAL
  if (error.code === 'NETWORK') return error.message
  if (error.code === 'RATE_LIMITED') {
    const seconds = Number((error.details as { retryAfter?: unknown } | undefined)?.retryAfter)
    return Number.isFinite(seconds) && seconds > 0 ? retryText(Math.ceil(seconds)) : errorMessage('RATE_LIMITED')
  }
  return weakPasswordText(error) ?? errorMessage(error.code)
}

/** Field messages of a `VALIDATION_FAILED` answer, keyed by the request field (first message per field). */
export function apiFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED') return {}
  const issues = (error.details as { issues?: Array<{ path?: unknown; message?: unknown }> } | undefined)?.issues
  const fields: Record<string, string> = {}
  for (const issue of Array.isArray(issues) ? issues : []) {
    if (typeof issue.path !== 'string' || typeof issue.message !== 'string') continue
    const field = issue.path.split('.')[0] || '_form'
    fields[field] ??= issue.message
  }
  return fields
}

export function isApiError(error: unknown, code?: string): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code)
}

/** "Firefox on Linux" from a user agent; good enough to recognize one's own devices in the sessions list. */
export function describeUserAgent(userAgent: string | null | undefined): {
  browser: string | null
  os: string | null
  label: string
} {
  const ua = userAgent ?? ''
  const browser = /Edg(?:e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\/|FxiOS\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : null
  const label = browser && os ? `${browser} on ${os}` : (browser ?? os ?? 'Unknown device')
  return { browser, os, label }
}

/** Unique messages of a TanStack field (schema issues or strings) plus an optional server message. */
export function fieldMessages(errors: readonly unknown[], extra?: string | null): string[] {
  const messages = errors
    .map((error) => (typeof error === 'string' ? error : (error as { message?: unknown } | undefined)?.message))
    .filter((message): message is string => typeof message === 'string' && message.length > 0)
  if (extra) messages.push(extra)
  return [...new Set(messages)]
}
