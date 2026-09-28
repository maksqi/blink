/**
 * ffprobe allowlist (pure). The source is probed before ffmpeg ever runs: the demuxer is forced from the MIME type the
 * recorder declared (webm → matroska, mp4 → mov), and only that container family, h264/vp8/vp9 video (at least one
 * stream, 1..4096 px), optional aac/opus audio and a declared duration within the limit pass. Anything else fails the
 * recording as `invalid_media` without starting ffmpeg. `evaluateOutput` checks the transcoded MP4.
 */
export type Demuxer = 'matroska' | 'mov'

export const PROBE_INPUT_LIMIT_BYTES = 32 * 1024 * 1024
export const MAX_SOURCE_DIMENSION = 4096
/** Same caps as the transcode (`-max_alloc`, `-max_pixels`), so probing cannot allocate more than ffmpeg would. */
export const FFMPEG_MAX_ALLOC_BYTES = 536_870_912
export const FFMPEG_MAX_PIXELS = 16_777_216

const FORMAT_NAMES: Record<Demuxer, string> = {
  matroska: 'matroska,webm',
  mov: 'mov,mp4,m4a,3gp,3g2,mj2',
}
const VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9'])
const AUDIO_CODECS = new Set(['aac', 'opus'])

/** `video/webm…` → matroska, `video/mp4…` → mov, anything else → null. */
export function demuxerForMime(mime: string | null | undefined): Demuxer | null {
  const type = (mime ?? '').split(';', 1)[0]!.trim().toLowerCase()
  if (type === 'video/webm') return 'matroska'
  if (type === 'video/mp4') return 'mov'
  return null
}

const SHOW_ENTRIES = 'stream=codec_type,codec_name,width,height:format=format_name,duration'

/** ffprobe arguments for the (decrypted) source streamed on stdin. */
export function probeArgs(demuxer: Demuxer): string[] {
  return [
    '-v', 'error',
    '-max_alloc', String(FFMPEG_MAX_ALLOC_BYTES),
    '-protocol_whitelist', 'pipe,file',
    '-f', demuxer,
    '-max_pixels', String(FFMPEG_MAX_PIXELS),
    '-show_entries', SHOW_ENTRIES,
    '-of', 'json',
    'pipe:0',
  ]
}

/** ffprobe arguments for the transcoded MP4 in the work dir. */
export function outputProbeArgs(path: string): string[] {
  return ['-v', 'error', '-protocol_whitelist', 'file', '-f', 'mov', '-show_entries', SHOW_ENTRIES, '-of', 'json', path]
}

export interface ProbeStream {
  codec_type?: unknown
  codec_name?: unknown
  width?: unknown
  height?: unknown
}

export interface ProbeJson {
  streams?: unknown
  format?: { format_name?: unknown; duration?: unknown }
}

export interface SourceInfo {
  videoCodec: string
  audioCodec: string | null
  width: number
  height: number
  /** Declared duration, if the container has one (MediaRecorder WebM often does not). */
  durationMs: number | null
}

export type ProbeVerdict = { ok: true; info: SourceInfo } | { ok: false; reason: string }

export function parseProbeJson(text: string): ProbeJson | null {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null ? (value as ProbeJson) : null
  } catch {
    return null
  }
}

function streamsOf(json: ProbeJson): ProbeStream[] {
  return Array.isArray(json.streams) ? (json.streams.filter((s) => typeof s === 'object' && s !== null) as ProbeStream[]) : []
}

function durationMsOf(json: ProbeJson): number | null {
  const raw = json.format?.duration
  if (raw === undefined || raw === null || raw === 'N/A') return null
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null
}

function dimension(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

/** Allowlist over ffprobe JSON of the source. */
export function evaluateSource(json: ProbeJson | null, limits: { demuxer: Demuxer; maxDurationMinutes: number }): ProbeVerdict {
  if (!json) return { ok: false, reason: 'unreadable' }
  if (json.format?.format_name !== FORMAT_NAMES[limits.demuxer]) return { ok: false, reason: 'container' }
  const streams = streamsOf(json)
  const video = streams.filter((s) => s.codec_type === 'video')
  const audio = streams.filter((s) => s.codec_type === 'audio')
  if (video.length === 0) return { ok: false, reason: 'no_video' }
  for (const stream of video) {
    if (typeof stream.codec_name !== 'string' || !VIDEO_CODECS.has(stream.codec_name)) return { ok: false, reason: 'video_codec' }
    const width = dimension(stream.width)
    const height = dimension(stream.height)
    if (!width || !height || width <= 0 || height <= 0 || width > MAX_SOURCE_DIMENSION || height > MAX_SOURCE_DIMENSION) {
      return { ok: false, reason: 'dimensions' }
    }
  }
  for (const stream of audio) {
    if (typeof stream.codec_name !== 'string' || !AUDIO_CODECS.has(stream.codec_name)) return { ok: false, reason: 'audio_codec' }
  }
  const durationMs = durationMsOf(json)
  if (durationMs !== null && durationMs > (limits.maxDurationMinutes + 1) * 60_000) return { ok: false, reason: 'duration' }
  const first = video[0]!
  return {
    ok: true,
    info: {
      videoCodec: first.codec_name as string,
      audioCodec: audio.length ? (audio[0]!.codec_name as string) : null,
      width: first.width as number,
      height: first.height as number,
      durationMs,
    },
  }
}

export interface OutputInfo {
  width: number
  height: number
  durationMs: number
  hasAudio: boolean
}

export type OutputVerdict = { ok: true; info: OutputInfo } | { ok: false; reason: string }

/** The transcoded file: exactly one h264 video stream, aac audio when the source had audio, a positive duration. */
export function evaluateOutput(json: ProbeJson | null, expectAudio: boolean): OutputVerdict {
  if (!json) return { ok: false, reason: 'unreadable' }
  const streams = streamsOf(json)
  const video = streams.filter((s) => s.codec_type === 'video')
  const audio = streams.filter((s) => s.codec_type === 'audio')
  if (video.length !== 1 || video[0]!.codec_name !== 'h264') return { ok: false, reason: 'video' }
  if (streams.length !== video.length + audio.length) return { ok: false, reason: 'extra_streams' }
  if (audio.length > 1 || audio.some((s) => s.codec_name !== 'aac')) return { ok: false, reason: 'audio' }
  if (expectAudio && audio.length === 0) return { ok: false, reason: 'audio_missing' }
  const width = dimension(video[0]!.width)
  const height = dimension(video[0]!.height)
  const durationMs = durationMsOf(json)
  if (!width || !height || durationMs === null || durationMs <= 0) return { ok: false, reason: 'metadata' }
  return { ok: true, info: { width, height, durationMs, hasAudio: audio.length > 0 } }
}
