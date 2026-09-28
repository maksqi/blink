/**
 * Post-login redirects (docs/SECURITY.md §3.4). Only relative, same-origin paths with a single leading "/" are
 * accepted, so a crafted `?next=` can never send someone to another site. Everything else falls back.
 */
export const DEFAULT_REDIRECT = '/dashboard'

const MAX_LENGTH = 2048
// Control characters and whitespace: URL parsers drop tabs and newlines, which turns "/\t/host" into "//host".
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARACTERS = /[\u0000-\u001F\u007F\s]/
// An encoded slash or backslash right after the leading "/" becomes "//host" once something decodes it.
const ENCODED_SEPARATOR = /^\/%(?:2f|5c)/i

export function isSafeRedirectPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LENGTH) return false
  if (!value.startsWith('/')) return false // relative to this origin only; also rules out "scheme:" values
  if (value.startsWith('//')) return false // protocol-relative URL
  if (value.includes('\\')) return false // browsers treat "\" like "/" ("/\host")
  if (UNSAFE_CHARACTERS.test(value) || ENCODED_SEPARATOR.test(value)) return false
  if (value.includes('#')) return false // fragments can carry secrets; never forward them
  return true
}

/**
 * Accepts a route query value (`route.query.next`) or any unknown input and returns a safe path.
 * Repeated parameters (`?next=a&next=b`) are ambiguous and rejected.
 */
export function safeRedirectPath(value: unknown, fallback: string = DEFAULT_REDIRECT): string {
  return isSafeRedirectPath(value) ? value : fallback
}
