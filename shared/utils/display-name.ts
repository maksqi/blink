/** Display names are normalized identically on client and server (docs/SECURITY.md §5). */

export const DISPLAY_NAME_MAX = 64

// Control (Cc), format (Cf: bidi overrides, zero-width joiners, ...), separators other than space, and private use.
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cs}]/gu

/** NFKC, strip invisible/bidi/control characters, collapse whitespace, trim, cap at 64 code points. */
export function normalizeDisplayName(input: string): string {
  const cleaned = input.normalize('NFKC').replace(FORBIDDEN, '').replace(/\s+/gu, ' ').trim()
  return Array.from(cleaned).slice(0, DISPLAY_NAME_MAX).join('').trim()
}
