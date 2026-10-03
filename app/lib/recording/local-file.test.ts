import { describe, expect, it } from 'vitest'
import { colorFor, initialsOf, labelFontSize, labelText } from './draw'
import { localFileName } from './local-file'

describe('localFileName', () => {
  const date = new Date(2026, 9, 3, 9, 5)

  it('names the file after the room and the local start time', () => {
    expect(localFileName('abc-defg-hjk', date, 'video/webm;codecs=vp8,opus')).toBe(
      'blinq-abc-defg-hjk-2026-10-03-0905.webm',
    )
    expect(localFileName('abc-defg-hjk', date, 'video/mp4;codecs=avc1,opus')).toBe(
      'blinq-abc-defg-hjk-2026-10-03-0905.mp4',
    )
  })

  it('keeps only safe characters', () => {
    expect(localFileName('../Team Sync: Q4!', date, 'video/webm')).toBe('blinq-team-sync-q4-2026-10-03-0905.webm')
    expect(localFileName('\u0000///', date, 'video/webm')).toBe('blinq-meeting-2026-10-03-0905.webm')
  })
})

describe('tile drawing helpers', () => {
  it('takes initials from the first and last word', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL')
    expect(initialsOf('  grace  brewster  hopper ')).toBe('GH')
    expect(initialsOf('Linus')).toBe('L')
    expect(initialsOf('')).toBe('?')
    expect(initialsOf('\u00e9mile zola')).toBe('\u00c9Z')
  })

  it('gives each identity a stable color', () => {
    expect(colorFor('p_abc')).toBe(colorFor('p_abc'))
    expect(colorFor('p_abc')).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('labels screen shares and scales the label with the tile', () => {
    expect(labelText('Ada', 'camera')).toBe('Ada')
    expect(labelText('Ada', 'screen')).toBe('Ada (screen)')
    expect(labelText('  ', 'camera')).toBe('Participant')
    expect(labelFontSize(100)).toBe(11)
    expect(labelFontSize(360)).toBe(20)
    expect(labelFontSize(1080)).toBe(26)
  })
})
