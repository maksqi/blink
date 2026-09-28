/**
 * Pure request rules used by server-core middleware (docs/API.md §1.1).
 *
 * - `normalizedPath(url)`: path without query, repeated slashes collapsed, no trailing slash. Checks run on this
 *   form, which is at least as strict as Nitro's router (it strips trailing slashes, never decodes).
 * - `csrfRejected(...)`: every method except GET/HEAD/OPTIONS needs `Origin` equal to the origin of `PUBLIC_URL`,
 *   and `Sec-Fetch-Site: same-origin` when that header is present. Only `POST /api/webhooks/livekit` is exempt
 *   (signature auth). `Host` and `X-Forwarded-Host` are never consulted. Applied to every path, not only `/api/**`,
 *   since nothing else accepts mutations (decision).
 * - `passwordChangeExempt(method, path)`: the only `/api/**` routes a user with `mustChangePassword` may call.
 * - `isProbePath(path)`: `/api/health` and `/api/ready` (no session lookup, no request log).
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const CSRF_EXEMPT = new Set(['POST /api/webhooks/livekit'])

const PASSWORD_CHANGE_EXEMPT = new Set([
  'GET /api/auth/me',
  'POST /api/auth/password',
  'POST /api/auth/logout',
  'GET /api/config',
  'GET /api/health',
  'GET /api/ready',
])

const PROBES = new Set(['/api/health', '/api/ready'])

export function normalizedPath(url: string): string {
  const path = url.split(/[?#]/, 1)[0]!.replace(/\/{2,}/g, '/')
  return path.length > 1 ? path.replace(/\/+$/, '') : path || '/'
}

export function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/')
}

export function isProbePath(path: string): boolean {
  return PROBES.has(path)
}

export function isCsrfExempt(method: string, path: string): boolean {
  return CSRF_EXEMPT.has(`${method.toUpperCase()} ${path}`)
}

export function csrfRejected(input: {
  method: string
  path: string
  origin: string | undefined
  secFetchSite: string | undefined
  publicOrigin: string
}): boolean {
  const method = input.method.toUpperCase()
  if (SAFE_METHODS.has(method) || isCsrfExempt(method, input.path)) return false
  if (input.origin !== input.publicOrigin) return true
  return input.secFetchSite !== undefined && input.secFetchSite !== 'same-origin'
}

export function passwordChangeExempt(method: string, path: string): boolean {
  const upper = method.toUpperCase()
  return PASSWORD_CHANGE_EXEMPT.has(`${upper === 'HEAD' ? 'GET' : upper} ${path}`)
}
