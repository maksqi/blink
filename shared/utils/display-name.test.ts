import { describe, expect, it } from 'vitest'
import { normalizeDisplayName } from './display-name'

describe('normalizeDisplayName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeDisplayName('  Ada   Lovelace \n')).toBe('Ada Lovelace')
  })

  it('removes bidi overrides, zero-width and control characters', () => {
    expect(normalizeDisplayName('Ad\u202Ea\u200B\u200DL\u0007ovelace')).toBe('AdaLovelace')
  })

  it('applies NFKC and caps at 64 code points', () => {
    expect(normalizeDisplayName('\uFF21\uFF22')).toBe('AB')
    expect(Array.from(normalizeDisplayName('\u{1F600}'.repeat(80)))).toHaveLength(64)
  })

  it('keeps non-Latin scripts', () => {
    const cyrillicName = '\u0418\u0432\u0430\u043D'
    expect(normalizeDisplayName(cyrillicName)).toBe(cyrillicName)
  })
})
