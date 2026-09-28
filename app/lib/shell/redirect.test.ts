import { describe, expect, it } from 'vitest'
import { DEFAULT_REDIRECT, isSafeRedirectPath, safeRedirectPath } from './redirect'

describe('safeRedirectPath', () => {
  it.each(['/', '/dashboard', '/rooms/0193a9f2-7b1c-7c3e-9d2a-1f2e3d4c5b6a', '/settings/sessions', '/recordings?page=2'])(
    'accepts the relative path %s',
    (path) => {
      expect(isSafeRedirectPath(path)).toBe(true)
      expect(safeRedirectPath(path)).toBe(path)
    },
  )

  it.each([
    ['protocol-relative', '//evil.example.com'],
    ['protocol-relative with path', '//evil.example.com/login'],
    ['backslash', '/\\evil.example.com'],
    ['backslash later', '/rooms\\..\\evil'],
    ['absolute https', 'https://evil.example.com'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,hi'],
    ['no leading slash', 'dashboard'],
    ['tab after slash', '/\t/evil.example.com'],
    ['newline', '/\n/evil.example.com'],
    ['space', '/ /evil.example.com'],
    ['encoded slash', '/%2F%2Fevil.example.com'],
    ['encoded backslash', '/%5cevil.example.com'],
    ['fragment', '/m/abc-defg-hjk#k=secret'],
    ['empty', ''],
    ['too long', `/${'a'.repeat(2048)}`],
  ])('rejects %s', (_label, value) => {
    expect(isSafeRedirectPath(value)).toBe(false)
    expect(safeRedirectPath(value)).toBe(DEFAULT_REDIRECT)
  })

  it('rejects values that are not a single string', () => {
    expect(safeRedirectPath(undefined)).toBe(DEFAULT_REDIRECT)
    expect(safeRedirectPath(null)).toBe(DEFAULT_REDIRECT)
    expect(safeRedirectPath(['/dashboard', '//evil.example.com'])).toBe(DEFAULT_REDIRECT)
    expect(safeRedirectPath(42)).toBe(DEFAULT_REDIRECT)
  })

  it('uses the given fallback', () => {
    expect(safeRedirectPath('//evil.example.com', '/')).toBe('/')
  })
})
