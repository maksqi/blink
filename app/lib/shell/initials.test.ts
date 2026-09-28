import { describe, expect, it } from 'vitest'
import { initials } from './initials'

describe('initials', () => {
  it.each([
    ['Ana Maria Silva', 'AS'],
    ['kofi', 'K'],
    ['  mei   lin  ', 'ML'],
    ['\u{e9}lodie durand', '\u{c9}D'],
    ['\u{1F600} smile', '\u{1F600}S'],
    ['', '?'],
    ['   ', '?'],
  ])('%j gives %j', (name, expected) => {
    expect(initials(name)).toBe(expected)
  })
})
