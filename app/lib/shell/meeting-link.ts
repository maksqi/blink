/**
 * "Join with a link" on the landing page. Only meeting links of this server (`<origin>/m/<slug>`) are accepted. The
 * caller opens the result with a full navigation (`window.location.assign`), so the fragment plugin captures the key
 * on load. The pasted link is never sent to the server: browsers do not send fragments, and the query is dropped.
 */
import { isValidSlug } from '../e2ee/keys'

export type MeetingLinkError = 'empty' | 'invalid' | 'other-server' | 'not-meeting'

export type MeetingLinkResult = { ok: true; href: string; slug: string } | { ok: false; error: MeetingLinkError }

export const MEETING_LINK_ERRORS: Record<MeetingLinkError, string> = {
  empty: 'Paste a meeting link first.',
  invalid: 'This is not a valid link. Copy the whole meeting link and try again.',
  'other-server': 'This link belongs to another server. Open it directly in your browser.',
  'not-meeting': 'This is not a meeting link. Meeting links look like /m/abc-defg-hjk.',
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
// "meet.example.com/m/..." or "localhost:3000/m/..." copied without its scheme.
const BARE_HOST = /^(?:localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)+|\[[0-9a-f:.]+\])(?::\d+)?(?:[/?#]|$)/i
const MEETING_PATH = /^\/m\/([^/]+)\/?$/

function toUrl(value: string, origin: URL): URL | null {
  try {
    if (!HAS_SCHEME.test(value) && BARE_HOST.test(value)) return new URL(`${origin.protocol}//${value}`)
    // Anything else is absolute or relative to this origin ("/m/<slug>#k=...").
    return new URL(value, origin)
  } catch {
    return null
  }
}

export function parseMeetingLink(input: string, currentOrigin: string): MeetingLinkResult {
  const value = input.trim()
  if (!value) return { ok: false, error: 'empty' }

  const origin = new URL(currentOrigin)
  const url = toUrl(value, origin)
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    return { ok: false, error: 'invalid' }
  }
  if (url.origin !== origin.origin) return { ok: false, error: 'other-server' }

  const slug = url.pathname.match(MEETING_PATH)?.[1]
  if (!slug || !isValidSlug(slug)) return { ok: false, error: 'not-meeting' }

  // Meeting links carry nothing in the query; dropping it keeps a misplaced secret off the server.
  return { ok: true, slug, href: `${origin.origin}/m/${slug}${url.hash}` }
}
