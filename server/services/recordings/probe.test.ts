import { describe, expect, it } from 'vitest'
import { demuxerForMime, evaluateOutput, evaluateSource, outputProbeArgs, parseProbeJson, probeArgs, type ProbeJson } from './probe'

const webm = (streams: unknown[], format: Record<string, unknown> = {}): ProbeJson => ({
  streams,
  format: { format_name: 'matroska,webm', ...format },
})
const mp4 = (streams: unknown[], format: Record<string, unknown> = {}): ProbeJson => ({
  streams,
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', ...format },
})
const video = (codec: string, width = 1280, height = 720) => ({ codec_type: 'video', codec_name: codec, width, height })
const audio = (codec: string) => ({ codec_type: 'audio', codec_name: codec })
const limits = { demuxer: 'matroska' as const, maxDurationMinutes: 240 }

describe('demuxerForMime', () => {
  it.each([
    ['video/webm', 'matroska'],
    ['video/webm;codecs=vp9,opus', 'matroska'],
    ['VIDEO/WEBM; codecs="vp8"', 'matroska'],
    ['video/mp4;codecs=avc1.64001F,mp4a.40.2', 'mov'],
    ['video/mp4', 'mov'],
  ])('%s → %s', (mime, demuxer) => {
    expect(demuxerForMime(mime)).toBe(demuxer)
  })

  it.each([null, undefined, '', 'video/x-matroska', 'application/x-mpegurl', 'video/quicktime', 'text/plain'])('%s → null', (mime) => {
    expect(demuxerForMime(mime)).toBeNull()
  })
})

describe('probe arguments', () => {
  it('forces the demuxer, reads stdin only and applies the allocation limits', () => {
    const args = probeArgs('mov')
    expect(args.join(' ')).toBe(
      '-v error -max_alloc 536870912 -protocol_whitelist pipe,file -f mov -max_pixels 16777216 ' +
        '-show_entries stream=codec_type,codec_name,width,height:format=format_name,duration -of json pipe:0',
    )
    expect(outputProbeArgs('/work/x/out.mp4')).toEqual(
      expect.arrayContaining(['-protocol_whitelist', 'file', '-f', 'mov', '/work/x/out.mp4']),
    )
  })
})

describe('evaluateSource', () => {
  it.each([
    ['vp9 + opus webm', webm([video('vp9'), audio('opus')]), 'vp9', 'opus'],
    ['vp8 without audio', webm([video('vp8')]), 'vp8', null],
    ['h264 + opus webm', webm([video('h264'), audio('opus')]), 'h264', 'opus'],
  ])('accepts %s', (_name, json, videoCodec, audioCodec) => {
    const verdict = evaluateSource(json, limits)
    expect(verdict).toEqual({ ok: true, info: { videoCodec, audioCodec, width: 1280, height: 720, durationMs: null } })
  })

  it('accepts fragmented mp4 with h264 + aac and reports the declared duration', () => {
    const verdict = evaluateSource(mp4([video('h264', 1920, 1080), audio('aac')], { duration: '12.345000' }), {
      demuxer: 'mov',
      maxDurationMinutes: 240,
    })
    expect(verdict).toEqual({ ok: true, info: { videoCodec: 'h264', audioCodec: 'aac', width: 1920, height: 1080, durationMs: 12_345 } })
  })

  it('tolerates subtitle, data and attachment streams (they are dropped later)', () => {
    const json = webm([video('vp8'), audio('opus'), { codec_type: 'subtitle', codec_name: 'subrip' }, { codec_type: 'data' }])
    expect(evaluateSource(json, limits).ok).toBe(true)
  })

  it.each([
    ['nothing parsed', null, 'unreadable'],
    ['another container than the forced one', mp4([video('h264')]), 'container'],
    ['a missing format', { streams: [video('vp8')] }, 'container'],
    ['audio only', webm([audio('opus')]), 'no_video'],
    ['no streams', webm([]), 'no_video'],
    ['an unsupported video codec', webm([video('mjpeg')]), 'video_codec'],
    ['av1 video', webm([video('av1')]), 'video_codec'],
    ['a second video stream with a bad codec', webm([video('vp8'), video('mpeg4')]), 'video_codec'],
    ['an unsupported audio codec', webm([video('vp8'), audio('mp3')]), 'audio_codec'],
    ['8192 × 8192 frames', webm([video('vp8', 8192, 8192)]), 'dimensions'],
    ['4097 px wide frames', webm([video('vp9', 4097, 100)]), 'dimensions'],
    ['zero-sized frames', webm([video('vp9', 0, 0)]), 'dimensions'],
    ['missing dimensions', webm([{ codec_type: 'video', codec_name: 'vp9' }]), 'dimensions'],
    ['a declared duration above the limit + 1 min', webm([video('vp8')], { duration: String(241 * 60 + 1) }), 'duration'],
  ])('rejects %s', (_name, json, reason) => {
    expect(evaluateSource(json as ProbeJson | null, limits)).toEqual({ ok: false, reason })
  })

  it('accepts 4096 px and a duration of exactly the limit + 1 min', () => {
    expect(evaluateSource(webm([video('vp9', 4096, 4096)], { duration: String(241 * 60) }), limits).ok).toBe(true)
  })

  it('parses ffprobe output defensively', () => {
    expect(parseProbeJson('{"streams":[]}')).toEqual({ streams: [] })
    expect(parseProbeJson('{')).toBeNull()
    expect(parseProbeJson('3')).toBeNull()
  })
})

describe('evaluateOutput', () => {
  const out = (streams: unknown[], duration = '10.000000') => mp4(streams, { duration })

  it('accepts one h264 stream plus aac audio and returns the metadata', () => {
    expect(evaluateOutput(out([video('h264', 1280, 720), audio('aac')]), true)).toEqual({
      ok: true,
      info: { width: 1280, height: 720, durationMs: 10_000, hasAudio: true },
    })
    expect(evaluateOutput(out([video('h264')]), false).ok).toBe(true)
  })

  it.each([
    ['vp9 video', out([video('vp9'), audio('aac')]), true, 'video'],
    ['two video streams', out([video('h264'), video('h264')]), false, 'video'],
    ['opus audio', out([video('h264'), audio('opus')]), true, 'audio'],
    ['missing audio', out([video('h264')]), true, 'audio_missing'],
    ['a subtitle stream', out([video('h264'), { codec_type: 'subtitle', codec_name: 'mov_text' }]), false, 'extra_streams'],
    ['a zero duration', out([video('h264')], '0'), false, 'metadata'],
  ])('rejects %s', (_name, json, expectAudio, reason) => {
    expect(evaluateOutput(json, expectAudio)).toEqual({ ok: false, reason })
  })
})
