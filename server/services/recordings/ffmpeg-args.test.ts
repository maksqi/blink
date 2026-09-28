import { describe, expect, it } from 'vitest'
import { targetSize, transcodeArgs, videoFilter, type TranscodeArgsInput } from './ffmpeg-args'

const input: TranscodeArgsInput = {
  demuxer: 'matroska',
  width: 1280,
  height: 720,
  maxDurationSec: 14_400,
  maxOutputBytes: 1_000_000_000,
  threads: 2,
  output: '/work/rec/out.mp4',
}

/** The value that follows `flag` (the flag must appear exactly once). */
function valueOf(args: string[], flag: string): string {
  const indexes = args.flatMap((arg, i) => (arg === flag ? [i] : []))
  expect(indexes, flag).toHaveLength(1)
  return args[indexes[0]! + 1]!
}

describe('transcodeArgs', () => {
  const args = transcodeArgs(input)

  it('matches the documented command line exactly', () => {
    expect(args.join(' ')).toBe(
      [
        '-nostdin -hide_banner -loglevel error -max_alloc 536870912 -protocol_whitelist pipe,file',
        '-f matroska -max_pixels 16777216 -i pipe:0',
        '-map 0:v:0 -map 0:a:0? -map_metadata -1 -map_chapters -1 -dn -sn',
        '-vf scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p,setsar=1',
        '-fps_mode cfr -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 128k -ar 48000 -ac 2',
        '-t 14400 -fs 1000000000 -threads 2 -movflags +faststart -f mp4 /work/rec/out.mp4',
      ].join(' '),
    )
  })

  it('carries every hardening flag', () => {
    expect(args).toContain('-nostdin')
    expect(valueOf(args, '-max_alloc')).toBe('536870912')
    expect(valueOf(args, '-protocol_whitelist')).toBe('pipe,file')
    expect(valueOf(args, '-max_pixels')).toBe('16777216')
    expect(valueOf(args, '-map_metadata')).toBe('-1')
    expect(valueOf(args, '-map_chapters')).toBe('-1')
    expect(args).toContain('-dn')
    expect(args).toContain('-sn')
    expect(valueOf(args, '-movflags')).toBe('+faststart')
    expect(valueOf(args, '-threads')).toBe('2')
    expect(valueOf(args, '-t')).toBe('14400')
    expect(valueOf(args, '-fs')).toBe('1000000000')
    // Input options come before the only input, which is stdin.
    expect(valueOf(args, '-i')).toBe('pipe:0')
    for (const flag of ['-max_alloc', '-protocol_whitelist', '-f', '-max_pixels']) {
      expect(args.indexOf(flag), flag).toBeLessThan(args.indexOf('-i'))
    }
    expect(args.indexOf('-f')).toBe(args.indexOf('-max_pixels') - 2)
  })

  it('maps only the first video and the optional first audio stream', () => {
    const maps = args.flatMap((arg, i) => (arg === '-map' ? [args[i + 1]] : []))
    expect(maps).toEqual(['0:v:0', '0:a:0?'])
  })

  it('always re-encodes to H.264/AAC and never copies streams', () => {
    expect(valueOf(args, '-c:v')).toBe('libx264')
    expect(valueOf(args, '-c:a')).toBe('aac')
    expect(args.some((arg) => arg === 'copy' || arg === '-c' || arg === '-codec' || arg.startsWith('-c:s') || arg.startsWith('-c:d'))).toBe(false)
    expect(args.join(' ')).not.toMatch(/\bcopy\b/)
  })

  it('writes a single mp4 output (the last argument) and reads nothing but stdin', () => {
    expect(args.at(-1)).toBe('/work/rec/out.mp4')
    expect(args.at(-2)).toBe('mp4')
    expect(args.filter((arg) => arg === '-i')).toHaveLength(1)
    expect(args.join(' ')).not.toMatch(/https?:|concat|lavfi|subfile|crypto|data:/)
  })

  it('forces the mov demuxer for mp4 sources', () => {
    const mov = transcodeArgs({ ...input, demuxer: 'mov' })
    // The first -f is the input demuxer, the second the output muxer.
    expect(mov[mov.indexOf('-f') + 1]).toBe('mov')
    expect(mov[mov.lastIndexOf('-f') + 1]).toBe('mp4')
  })

  it('rejects odd, zero or non-integer limits', () => {
    expect(() => transcodeArgs({ ...input, width: 1279 })).toThrow(RangeError)
    expect(() => transcodeArgs({ ...input, threads: 0 })).toThrow(RangeError)
    expect(() => transcodeArgs({ ...input, maxOutputBytes: 1.5 })).toThrow(RangeError)
    expect(() => transcodeArgs({ ...input, maxDurationSec: -1 })).toThrow(RangeError)
  })

  it('builds the scale, pad, fps, pixel format and sample-aspect filter chain', () => {
    expect(videoFilter(640, 360)).toBe(
      'scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p,setsar=1',
    )
  })
})

describe('targetSize', () => {
  it.each([
    [{ width: 1280, height: 720 }, '1080p', { width: 1280, height: 720 }],
    [{ width: 1920, height: 1080 }, '1080p', { width: 1920, height: 1080 }],
    [{ width: 1920, height: 1080 }, '720p', { width: 1280, height: 720 }],
    [{ width: 3840, height: 2160 }, '1080p', { width: 1920, height: 1080 }],
    [{ width: 641, height: 361 }, '1080p', { width: 640, height: 360 }],
    [{ width: 320, height: 240 }, '720p', { width: 320, height: 240 }],
    [{ width: 1080, height: 1920 }, '720p', { width: 404, height: 720 }],
    [{ width: 4096, height: 4096 }, '720p', { width: 720, height: 720 }],
    [{ width: 1, height: 1 }, '720p', { width: 2, height: 2 }],
  ] as const)('%o within %s → %o', (source, resolution, expected) => {
    expect(targetSize(source, resolution)).toEqual(expected)
  })
})
