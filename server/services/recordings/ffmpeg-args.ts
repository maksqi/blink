/**
 * Pure ffmpeg argument builder for the hardened transcode (docs/SECURITY.md §6, Stage 08). The source streams in on
 * `pipe:0` through a forced demuxer; only the first video and (optional) first audio stream are mapped; metadata,
 * chapters, data and subtitle streams are dropped; everything is always re-encoded (never `-c copy`) to faststart
 * H.264/AAC at a constant 30 fps inside a fixed, even-sized frame.
 */
import type { Resolution } from '#shared/schemas/settings'
import { FFMPEG_MAX_ALLOC_BYTES, FFMPEG_MAX_PIXELS, type Demuxer } from './probe'

export const RESOLUTION_BOX: Record<Resolution, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
}

function even(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2)
}

/** Output frame: the source size rounded down to even numbers, fitted into the resolution box (aspect preserved). */
export function targetSize(source: { width: number; height: number }, maxResolution: Resolution): { width: number; height: number } {
  const box = RESOLUTION_BOX[maxResolution]
  const scale = Math.min(1, box.width / source.width, box.height / source.height)
  return { width: even(source.width * scale), height: even(source.height * scale) }
}

export interface TranscodeArgsInput {
  demuxer: Demuxer
  width: number
  height: number
  /** `-t`: recording.maxDurationMinutes in seconds. */
  maxDurationSec: number
  /** `-fs`: the space the work dir can give the output. */
  maxOutputBytes: number
  threads: number
  output: string
}

export function videoFilter(width: number, height: number): string {
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    'fps=30',
    'format=yuv420p',
    'setsar=1',
  ].join(',')
}

export function transcodeArgs(input: TranscodeArgsInput): string[] {
  for (const [name, value] of Object.entries({
    width: input.width,
    height: input.height,
    maxDurationSec: input.maxDurationSec,
    maxOutputBytes: input.maxOutputBytes,
    threads: input.threads,
  })) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`transcodeArgs: invalid ${name}`)
  }
  if (input.width % 2 || input.height % 2) throw new RangeError('transcodeArgs: the frame size must be even')
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-max_alloc', String(FFMPEG_MAX_ALLOC_BYTES),
    '-protocol_whitelist', 'pipe,file',
    '-f', input.demuxer,
    '-max_pixels', String(FFMPEG_MAX_PIXELS),
    '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0?',
    '-map_metadata', '-1', '-map_chapters', '-1', '-dn', '-sn',
    '-vf', videoFilter(input.width, input.height),
    '-fps_mode', 'cfr',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
    '-t', String(input.maxDurationSec),
    '-fs', String(input.maxOutputBytes),
    '-threads', String(input.threads),
    '-movflags', '+faststart',
    '-f', 'mp4',
    input.output,
  ]
}
