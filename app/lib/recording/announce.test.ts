import { describe, expect, it } from 'vitest'
import { formatElapsed, indicatorDisclosure, recordingAnnouncement } from './announce'

const rec = (by: string, startedAt: string) => ({ by, startedAt })

describe('recordingAnnouncement', () => {
  it('tells a late joiner that the meeting is being recorded', () => {
    expect(recordingAnnouncement(null, rec('Ada', 't1'), { initial: true, own: false })).toBe(
      'This meeting is being recorded.',
    )
  })

  it('names who started recording, or tells the recorder', () => {
    expect(recordingAnnouncement(null, rec('Ada', 't1'), { initial: false, own: false })).toBe('Ada started recording.')
    expect(recordingAnnouncement(null, rec('Ada', 't1'), { initial: false, own: true })).toBe(
      'You started recording. Everyone in the meeting can see it.',
    )
    expect(recordingAnnouncement(rec('Ada', 't1'), rec('Bob', 't2'), { initial: false, own: false })).toBe(
      'Bob started recording.',
    )
  })

  it('announces the stop and stays quiet otherwise', () => {
    expect(recordingAnnouncement(rec('Ada', 't1'), null, { initial: false, own: false })).toBe('Recording stopped.')
    expect(recordingAnnouncement(rec('Ada', 't1'), rec('Ada', 't1'), { initial: false, own: false })).toBeNull()
    expect(recordingAnnouncement(null, null, { initial: true, own: false })).toBeNull()
  })
})

describe('indicatorDisclosure', () => {
  it('discloses that the server can decrypt server recordings', () => {
    expect(indicatorDisclosure({ by: 'Ada', mode: 'server' })).toBe(
      'The recording is uploaded and stored encrypted on the server; the server and its admins can decrypt it.',
    )
    expect(indicatorDisclosure({ by: 'Ada', mode: 'local' })).toBe("Recording on Ada's device")
  })
})

describe('formatElapsed', () => {
  it('formats minutes and hours', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(65_400)).toBe('1:05')
    expect(formatElapsed(3_600_000 + 2 * 60_000 + 3_000)).toBe('1:02:03')
    expect(formatElapsed(-5000)).toBe('0:00')
    expect(formatElapsed(Number.NaN)).toBe('0:00')
  })
})
