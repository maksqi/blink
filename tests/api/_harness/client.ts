/**
 * HTTP client for API tests.
 *
 *   const api = createClient()                   // own cookie jar and own X-Forwarded-For (uniqueIp())
 *   const res = await api.post('/api/rooms', { body: { ... } })
 *   expectApiError(res, 403, 'CSRF_REJECTED')
 *
 * - Mutations send `Origin: <apiBaseUrl>` like a browser; pass `origin: null` (omit) or another value to test CSRF.
 * - Every client has its own IP (a random IPv6 /64 in 2001:db8::/32), so rate limits never leak between tests.
 * - Cookies from `Set-Cookie` are kept (and removed on `Max-Age=0`); `setCookie()` adds one directly.
 * - JSON bodies are parsed when the response is JSON; `text` always holds the raw body.
 */
import { randomBytes, randomInt } from 'node:crypto'
import { expect } from 'vitest'
import { apiBaseUrl } from './context'

/**
 * Response bodies are loosely typed on purpose: tests read nested fields (`res.body.data.code`) without casts and
 * assert their shape explicitly.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LooseBody = any

export interface ApiResponse<T = LooseBody> {
  status: number
  headers: Headers
  body: T
  text: string
  setCookies: string[]
}

export interface RequestOptions {
  /** JSON body. */
  body?: unknown
  /** Raw body (set `content-type` in `headers`). */
  raw?: string | Uint8Array<ArrayBuffer>
  headers?: Record<string, string>
  /** Defaults to the API origin for mutations and nothing for GET/HEAD; `null` omits it. */
  origin?: string | null
  /** Defaults to the client's IP; `null` omits the header. */
  ip?: string | null
  query?: Record<string, string | number | boolean>
}

/** A random address in documentation ranges: an IPv6 /64 in 2001:db8::/32, or 198.51.100.0/24 / 203.0.113.0/24. */
export function uniqueIp(version: 4 | 6 = 6): string {
  if (version === 4) return `${randomInt(2) ? '198.51.100' : '203.0.113'}.${randomInt(1, 255)}`
  const group = () => randomBytes(2).toString('hex').replace(/^0+(?=.)/, '')
  return `2001:db8:${group()}:${group()}::${randomInt(1, 0xffff).toString(16)}`
}

export class ApiClient {
  readonly baseUrl: string
  readonly cookies = new Map<string, string>()
  ip: string
  /** Set by `loginAs()`. */
  session?: { id: string; token: string }

  constructor(options: { ip?: string; baseUrl?: string } = {}) {
    this.baseUrl = options.baseUrl ?? apiBaseUrl()
    this.ip = options.ip ?? uniqueIp()
  }

  get origin(): string {
    return new URL(this.baseUrl).origin
  }

  setCookie(name: string, value: string): this {
    this.cookies.set(name, value)
    return this
  }

  cookie(name: string): string | undefined {
    return this.cookies.get(name)
  }

  cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  async request<T = LooseBody>(method: string, path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    const url = new URL(path, this.baseUrl)
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, String(value))
    const upper = method.toUpperCase()
    const headers = new Headers(options.headers)
    if (!headers.has('accept')) headers.set('accept', 'application/json')
    const origin = options.origin === undefined ? (['GET', 'HEAD', 'OPTIONS'].includes(upper) ? null : this.origin) : options.origin
    if (origin !== null && !headers.has('origin')) headers.set('origin', origin)
    const ip = options.ip === undefined ? this.ip : options.ip
    if (ip !== null) headers.set('x-forwarded-for', ip)
    const cookie = this.cookieHeader()
    if (cookie && !headers.has('cookie')) headers.set('cookie', cookie)
    let body: string | Uint8Array<ArrayBuffer> | undefined = options.raw
    if (body === undefined && options.body !== undefined) {
      body = JSON.stringify(options.body)
      if (!headers.has('content-type')) headers.set('content-type', 'application/json')
    }

    const response = await fetch(url, { method: upper, headers, body, redirect: 'manual' })
    const setCookies = response.headers.getSetCookie()
    this.store(setCookies)
    const text = await response.text()
    const isJson = (response.headers.get('content-type') ?? '').includes('json')
    return { status: response.status, headers: response.headers, body: (isJson && text ? JSON.parse(text) : text) as T, text, setCookies }
  }

  get<T = LooseBody>(path: string, options?: RequestOptions) {
    return this.request<T>('GET', path, options)
  }

  post<T = LooseBody>(path: string, options?: RequestOptions) {
    return this.request<T>('POST', path, options)
  }

  put<T = LooseBody>(path: string, options?: RequestOptions) {
    return this.request<T>('PUT', path, options)
  }

  patch<T = LooseBody>(path: string, options?: RequestOptions) {
    return this.request<T>('PATCH', path, options)
  }

  delete<T = LooseBody>(path: string, options?: RequestOptions) {
    return this.request<T>('DELETE', path, options)
  }

  private store(setCookies: string[]) {
    for (const header of setCookies) {
      const [pair = '', ...attributes] = header.split(';')
      const index = pair.indexOf('=')
      if (index < 1) continue
      const name = pair.slice(0, index).trim()
      const value = pair.slice(index + 1).trim()
      const expired = attributes.some((attribute) => {
        const [key = '', raw = ''] = attribute.split('=').map((part) => part.trim())
        if (key.toLowerCase() === 'max-age') return Number(raw) <= 0
        if (key.toLowerCase() === 'expires') return Date.parse(raw) <= Date.now()
        return false
      })
      if (expired || value === '') this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }
}

export function createClient(options?: { ip?: string; baseUrl?: string }): ApiClient {
  return new ApiClient(options)
}

/** Asserts the documented error envelope: status, `statusCode`, `statusMessage` and `data.code`. */
export function expectApiError(res: ApiResponse, status: number, code: string): void {
  expect(res.status, res.text).toBe(status)
  expect(res.body, res.text).toMatchObject({ statusCode: status, data: { code } })
  expect(typeof res.body.statusMessage).toBe('string')
}
