/**
 * Chat text → render segments (pure). Chat is text-only: the UI renders segments with text interpolation and
 * `<a :href>` only, never `v-html` and never markdown (docs/SECURITY.md §5).
 *
 * - Links: only `http:`/`https:` URLs (any letter case) that `new URL()` accepts, starting at a word boundary. They stop
 *   at whitespace, quotes and angle brackets; trailing punctuation is trimmed (a closing bracket stays when it closes
 *   one inside the URL). `javascript:`, `data:`, `vbscript:` and anything else stays plain text.
 * - Bidi override and isolate controls (U+202A..U+202E, U+2066..U+2069) are removed (decision), so a message cannot
 *   reorder the text around it or disguise a link.
 * - Linear time: one regex pass with a simple character class, and linear trimming.
 */

export type ChatSegment = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string }

const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g

export function stripBidiControls(text: string): string {
  return text.replace(BIDI_CONTROLS, '')
}

// No lookbehind for the word boundary: older Safari versions reject it at parse time.
const URL_CANDIDATE = /https?:\/\/[^\s<>"'`]+/giu
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', '*', '_', '~'])
const PAIRS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
const WORD_CHAR = /[\p{L}\p{N}_]/u

function trimTrailing(candidate: string): string {
  const opened: Record<string, number> = { '(': 0, '[': 0, '{': 0 }
  const closed: Record<string, number> = { ')': 0, ']': 0, '}': 0 }
  for (const char of candidate) {
    if (char in opened) opened[char]!++
    else if (char in closed) closed[char]!++
  }
  let end = candidate.length
  while (end > 0) {
    const char = candidate[end - 1]!
    if (!TRAILING.has(char)) break
    const open = PAIRS[char]
    // Keep a closing bracket that closes one inside the URL: https://en.wikipedia.org/wiki/Foo_(bar)
    if (open && closed[char]! <= opened[open]!) break
    if (open) closed[char]!--
    end--
  }
  return candidate.slice(0, end)
}

/** A safe absolute http(s) href for `candidate`, or null. */
export function safeHref(candidate: string): string | null {
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname) return null
  return url.href
}

export function linkify(input: string): ChatSegment[] {
  const text = stripBidiControls(input)
  const segments: ChatSegment[] = []
  let cursor = 0
  const pushText = (value: string) => {
    if (!value) return
    const last = segments.at(-1)
    if (last?.kind === 'text') last.text += value
    else segments.push({ kind: 'text', text: value })
  }

  for (const match of text.matchAll(URL_CANDIDATE)) {
    const start = match.index
    // "xhttps://..." does not start a link.
    if (start > 0 && WORD_CHAR.test(text[start - 1]!)) continue
    const candidate = trimTrailing(match[0])
    const href = safeHref(candidate)
    if (!href) continue
    pushText(text.slice(cursor, start))
    segments.push({ kind: 'link', text: candidate, href })
    cursor = start + candidate.length
  }
  pushText(text.slice(cursor))
  return segments
}
