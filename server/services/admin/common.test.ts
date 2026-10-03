import { H3Error } from 'h3'
import { describe, expect, it } from 'vitest'
import { assertAdminActor, likePattern, routeId } from './common'

function codeOf(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    if (error instanceof H3Error) return [error.statusCode, (error.data as { code?: string }).code]
    throw error
  }
  return undefined
}

describe('routeId', () => {
  it('accepts uuids (normalized to lowercase)', () => {
    expect(routeId('01890000-0000-7000-8000-0000000000AA')).toBe('01890000-0000-7000-8000-0000000000aa')
  })

  it('answers 404 NOT_FOUND for anything else, before any query', () => {
    for (const value of [undefined, '', 'abc', '-'.repeat(36), '01890000-0000-7000-8000-0000000000aa; drop']) {
      expect(codeOf(() => routeId(value))).toEqual([404, 'NOT_FOUND'])
    }
  })
})

describe('likePattern', () => {
  it('wraps the text and escapes LIKE wildcards', () => {
    expect(likePattern('ada')).toBe('%ada%')
    expect(likePattern('a%b_c\\')).toBe('%a\\%b\\_c\\\\%')
  })
})

describe('assertAdminActor', () => {
  it('rejects non-admin actors and returns the injected clock', () => {
    const now = new Date('2026-09-01T00:00:00.000Z')
    expect(assertAdminActor({ user: { id: 'a', role: 'admin' }, event: null, now })).toBe(now)
    expect(codeOf(() => assertAdminActor({ user: { id: 'a', role: 'user' }, event: null }))).toEqual([403, 'FORBIDDEN'])
  })
})
