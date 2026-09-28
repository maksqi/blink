import { describe, expect, it } from 'vitest'
import { contentDisposition, createAccessDebouncer, encodeRfc5987, recordingFileName } from './serve'
import { fsTypeFor, parseMounts } from './storage'
import { recordingRetentionCutoffs } from './tasks'

const day = new Date('2026-09-28T23:59:59Z')

describe('recording file names', () => {
  it('builds blinq-<room>-<date>.mp4 from the room name and the UTC start date', () => {
    expect(recordingFileName('Weekly sync', day)).toBe('blinq-Weekly sync-2026-09-28.mp4')
  })

  it('removes path separators, quotes, control, bidi and zero-width characters', () => {
    expect(recordingFileName('a/b\\c"d<e>f|g?h*i:j', day)).toBe('blinq-a b c d e f g h i j-2026-09-28.mp4')
    expect(recordingFileName('x\u202e\u200b\u0007y\n z', day)).toBe('blinq-xy z-2026-09-28.mp4')
    expect(recordingFileName('   ', day)).toBe('blinq-recording-2026-09-28.mp4')
    expect(recordingFileName('\u202e', day)).toBe('blinq-recording-2026-09-28.mp4')
  })

  it('caps the room part at 80 characters', () => {
    const name = recordingFileName('a'.repeat(200), day)
    expect(name).toBe(`blinq-${'a'.repeat(80)}-2026-09-28.mp4`)
  })

  it('encodes RFC 5987 ext-values, including the characters encodeURIComponent leaves alone', () => {
    expect(encodeRfc5987("it's (a) *test*")).toBe('it%27s%20%28a%29%20%2Atest%2A')
    expect(encodeRfc5987('Caf\u00e9 \u{1F3A5}')).toBe('Caf%C3%A9%20%F0%9F%8E%A5')
    expect(encodeRfc5987('a-b_c.d~e!f')).toBe('a-b_c.d~e!f')
  })

  it('sends an ASCII fallback plus the encoded name', () => {
    expect(contentDisposition('inline', 'blinq-A B-2026-09-28.mp4')).toBe(
      `inline; filename="blinq-recording.mp4"; filename*=UTF-8''blinq-A%20B-2026-09-28.mp4`,
    )
    expect(contentDisposition('attachment', 'x.mp4')).toMatch(/^attachment; /)
  })
})

describe('admin access debouncer', () => {
  it('records once per key per window', () => {
    const debouncer = createAccessDebouncer(10 * 60_000)
    expect(debouncer.shouldRecord('admin|rec|playback', 0)).toBe(true)
    expect(debouncer.shouldRecord('admin|rec|playback', 1_000)).toBe(false)
    expect(debouncer.shouldRecord('admin|rec|download', 1_000)).toBe(true)
    expect(debouncer.shouldRecord('other|rec|playback', 1_000)).toBe(true)
    expect(debouncer.shouldRecord('admin|rec|playback', 10 * 60_000 - 1)).toBe(false)
    expect(debouncer.shouldRecord('admin|rec|playback', 10 * 60_000)).toBe(true)
  })

  it('stays bounded', () => {
    const debouncer = createAccessDebouncer(60_000, 3)
    for (let i = 0; i < 10; i++) debouncer.shouldRecord(`k${i}`, i)
    // The oldest keys were dropped, so they count as new again.
    expect(debouncer.shouldRecord('k0', 20)).toBe(true)
    expect(debouncer.shouldRecord('k9', 20)).toBe(false)
  })
})

describe('tmpfs detection', () => {
  const mounts = parseMounts(
    [
      'overlay / overlay rw,relatime 0 0',
      'tmpfs /work tmpfs rw,nosuid,nodev,size=4194304k,mode=700,uid=10001,gid=10001 0 0',
      'tmpfs /tmp tmpfs rw 0 0',
      '/dev/sda1 /data/recordings ext4 rw 0 0',
      'tmpfs /mnt/with\\040space tmpfs rw 0 0',
    ].join('\n'),
  )

  it('finds the file system of the longest matching mount point', () => {
    expect(fsTypeFor('/work', mounts)).toBe('tmpfs')
    expect(fsTypeFor('/work/0199a3b4', mounts)).toBe('tmpfs')
    expect(fsTypeFor('/workspace', mounts)).toBe('overlay')
    expect(fsTypeFor('/data/recordings/x', mounts)).toBe('ext4')
    expect(fsTypeFor('/mnt/with space/a', mounts)).toBe('tmpfs')
    expect(fsTypeFor('/app', mounts)).toBe('overlay')
  })

  it('returns null without mounts', () => {
    expect(fsTypeFor('/work', [])).toBeNull()
  })
})

describe('recording retention cutoffs', () => {
  it('derives the age limit from recording.retentionDays and keeps orphans for a day', () => {
    const now = new Date('2026-09-28T03:23:00Z')
    expect(recordingRetentionCutoffs(now, 30)).toEqual({
      now,
      olderThan: new Date('2026-08-29T03:23:00Z'),
      orphanBefore: new Date('2026-09-27T03:23:00Z'),
    })
  })
})
