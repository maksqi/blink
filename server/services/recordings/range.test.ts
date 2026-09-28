import { describe, expect, it } from 'vitest'
import { contentRange, parseRange, unsatisfiedRange } from './range'

describe('parseRange', () => {
  const size = 1000

  it('serves the whole file without a Range header', () => {
    expect(parseRange(undefined, size)).toEqual({ kind: 'full' })
    expect(parseRange(null, size)).toEqual({ kind: 'full' })
  })

  it.each([
    ['bytes=0-0', 0, 0],
    ['bytes=0-499', 0, 499],
    ['bytes=500-999', 500, 999],
    ['bytes=500-', 500, 999],
    ['bytes=0-', 0, 999],
    ['bytes=999-', 999, 999],
    ['bytes=900-5000', 900, 999],
    ['bytes=-1', 999, 999],
    ['bytes=-100', 900, 999],
    ['bytes=-1000', 0, 999],
    ['bytes=-5000', 0, 999],
    [' bytes=10-20 ', 10, 20],
  ])('%s selects %i-%i', (header, start, end) => {
    expect(parseRange(header, size)).toEqual({ kind: 'partial', start, end })
  })

  it.each(['bytes=1000-', 'bytes=1000-1001', 'bytes=5000-6000', 'bytes=-0', 'bytes=9999999999999999-'])(
    '%s is unsatisfiable',
    (header) => {
      expect(parseRange(header, size)).toEqual({ kind: 'unsatisfiable' })
    },
  )

  it.each(['bytes=0-1,5-6', 'bytes=0-1, 3-4', 'items=0-1', 'bytes=abc', 'bytes=1-2-3', 'bytes=-', 'bytes=20-10', 'bytes 0-1', ''])(
    'ignores %j and serves the whole file',
    (header) => {
      expect(parseRange(header, size)).toEqual({ kind: 'full' })
    },
  )

  it('treats every range of an empty file as unsatisfiable', () => {
    expect(parseRange('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange('bytes=-5', 0)).toEqual({ kind: 'unsatisfiable' })
  })

  it('formats Content-Range values', () => {
    expect(contentRange(0, 99, 1000)).toBe('bytes 0-99/1000')
    expect(unsatisfiedRange(1000)).toBe('bytes */1000')
  })
})
