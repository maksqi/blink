/**
 * Pure HTTP Range parsing for the recording file route (RFC 9110 §14). One range only:
 * `bytes=a-b`, `bytes=a-` and `bytes=-n`. Several ranges, other units and malformed values are ignored (full 200
 * response); a syntactically valid range that selects nothing is unsatisfiable (416 with `bytes *\/size`).
 */
export type RangeResult =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable' }

const SINGLE = /^bytes=(\d*)-(\d*)$/

export function parseRange(header: string | undefined | null, size: number): RangeResult {
  if (header === undefined || header === null) return { kind: 'full' }
  const value = header.trim()
  // Several ranges would need multipart/byteranges; serving the whole file is allowed and simpler.
  if (value.includes(',')) return { kind: 'full' }
  const match = value.match(SINGLE)
  if (!match) return { kind: 'full' }
  const [, first = '', last = ''] = match
  if (first === '' && last === '') return { kind: 'full' }
  if (first.length > 15 || last.length > 15) return first === '' ? { kind: 'full' } : { kind: 'unsatisfiable' }

  if (first === '') {
    // Suffix range: the last n bytes.
    const length = Number(last)
    if (length === 0 || size === 0) return { kind: 'unsatisfiable' }
    return { kind: 'partial', start: Math.max(0, size - length), end: size - 1 }
  }
  const start = Number(first)
  if (last !== '' && Number(last) < start) return { kind: 'full' }
  if (start >= size) return { kind: 'unsatisfiable' }
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1)
  return { kind: 'partial', start, end }
}

export function contentRange(start: number, end: number, size: number): string {
  return `bytes ${start}-${end}/${size}`
}

export function unsatisfiedRange(size: number): string {
  return `bytes */${size}`
}
