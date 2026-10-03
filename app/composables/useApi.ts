import { errorMessage, type ErrorCode } from '#shared/utils/error-codes'

/** Error thrown by `api()`: carries the stable server error code and an English message for the UI. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | 'NETWORK',
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

interface FetchErrorLike {
  name: string
  response?: { status: number }
  data?: { data?: { code?: string; details?: unknown } }
}

function isFetchError(error: unknown): error is FetchErrorLike {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'FetchError'
}

/**
 * JSON API client for /api/*. Same-origin only; cookies are sent automatically. Maps error payloads
 * `{ data: { code } }` to ApiError. During SSR it forwards the incoming cookies.
 */
type LooseFetch = (url: string, options: Record<string, unknown>) => Promise<unknown>

export function useApi() {
  // Nitro's typed-route inference explodes on dynamic string paths; responses are typed by the caller instead.
  const requestFetch = useRequestFetch() as unknown as LooseFetch
  const nuxtApp = tryUseNuxtApp()

  return async function api<T>(
    path: string,
    options: { method?: Method; body?: unknown; query?: Record<string, unknown>; signal?: AbortSignal } = {},
  ): Promise<T> {
    try {
      return (await requestFetch(path, {
        method: options.method ?? 'GET',
        body: options.body,
        query: options.query,
        signal: options.signal,
        headers: { accept: 'application/json' },
      })) as T
    } catch (error) {
      if (isFetchError(error)) {
        if (!error.response) throw new ApiError(0, 'NETWORK', 'Network error. Check your connection.')
        const code = error.data?.data?.code
        // An expired or revoked session: listeners drop per-user browser state such as the key vault (SECURITY.md §3.1).
        if (import.meta.client && error.response.status === 401 && code === 'UNAUTHENTICATED') {
          void nuxtApp?.callHook('blinq:session-lost')
        }
        throw new ApiError(
          error.response.status,
          (code ?? 'INTERNAL') as ErrorCode,
          errorMessage(code),
          error.data?.data?.details,
        )
      }
      throw error
    }
  }
}
