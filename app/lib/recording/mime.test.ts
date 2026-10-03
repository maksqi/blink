import { describe, expect, it } from 'vitest'
import { baseMimeType, containerOf, pickRecordingMime, RECORDING_MIME_CANDIDATES } from './mime'

const supports =
  (...types: string[]) =>
  (mime: string) =>
    types.includes(mime)

describe('pickRecordingMime', () => {
  it('prefers MP4 with H.264 High and AAC when everything is supported', () => {
    expect(pickRecordingMime(() => true)).toBe('video/mp4;codecs=avc1.64001F,mp4a.40.2')
  })

  it('walks the candidates in the documented order', () => {
    const order: string[] = []
    pickRecordingMime((mime) => {
      order.push(mime)
      return false
    })
    expect(order).toEqual([...RECORDING_MIME_CANDIDATES])
    expect(order).toEqual([
      'video/mp4;codecs=avc1.64001F,mp4a.40.2',
      'video/mp4;codecs=avc1.42E01F,mp4a.40.2',
      'video/mp4;codecs=avc1.64001F,opus',
      'video/mp4;codecs=avc1,opus',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ])
  })

  it('takes the next candidate each time one is missing', () => {
    const all = [...RECORDING_MIME_CANDIDATES]
    for (let index = 0; index < all.length; index++) {
      expect(pickRecordingMime(supports(...all.slice(index)))).toBe(all[index])
    }
  })

  it('lands on WebM VP8/Opus in Firefox', () => {
    expect(pickRecordingMime(supports('video/webm;codecs=vp8,opus', 'video/webm'))).toBe('video/webm;codecs=vp8,opus')
  })

  it('falls back to plain WebM', () => {
    expect(pickRecordingMime(supports('video/webm'))).toBe('video/webm')
  })

  it('returns null when the browser can record none of them', () => {
    expect(pickRecordingMime(() => false)).toBeNull()
    expect(pickRecordingMime(supports('video/x-matroska'))).toBeNull()
  })

  it('treats a throwing isTypeSupported as unsupported', () => {
    const picked = pickRecordingMime((mime) => {
      if (mime.startsWith('video/mp4')) throw new Error('bad type')
      return true
    })
    expect(picked).toBe('video/webm;codecs=vp9,opus')
  })

  describe('forced family (test hook)', () => {
    it('keeps only WebM candidates', () => {
      expect(pickRecordingMime(() => true, 'video/webm')).toBe('video/webm;codecs=vp9,opus')
    })

    it('keeps only MP4 candidates', () => {
      expect(pickRecordingMime(supports('video/mp4;codecs=avc1,opus', 'video/webm'), 'video/mp4')).toBe(
        'video/mp4;codecs=avc1,opus',
      )
    })

    it('returns null instead of another family when the forced one is unsupported', () => {
      expect(pickRecordingMime(supports('video/webm;codecs=vp8,opus'), 'video/mp4')).toBeNull()
    })

    it('accepts a more specific prefix and ignores case and whitespace', () => {
      expect(pickRecordingMime(() => true, ' Video/WebM;codecs=vp8 ')).toBe('video/webm;codecs=vp8,opus')
    })

    it('ignores an empty or null force', () => {
      expect(pickRecordingMime(() => true, null)).toBe(RECORDING_MIME_CANDIDATES[0])
      expect(pickRecordingMime(() => true, '')).toBe(RECORDING_MIME_CANDIDATES[0])
    })
  })
})

describe('containerOf and baseMimeType', () => {
  it('maps MIME types to containers and plain types', () => {
    expect(containerOf('video/mp4;codecs=avc1,opus')).toBe('mp4')
    expect(containerOf('video/webm;codecs=vp8,opus')).toBe('webm')
    expect(containerOf('video/webm')).toBe('webm')
    expect(baseMimeType('video/mp4;codecs=avc1.64001F,mp4a.40.2')).toBe('video/mp4')
    expect(baseMimeType('Video/WebM')).toBe('video/webm')
  })
})
