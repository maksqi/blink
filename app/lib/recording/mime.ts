/**
 * MediaRecorder format choice (pure). The server re-encodes everything to H.264/AAC, so the browser records whatever
 * it supports best: MP4 first (Chrome, Safari), then WebM (Firefox lands on VP8/Opus).
 */

export const RECORDING_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.64001F,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01F,mp4a.40.2',
  'video/mp4;codecs=avc1.64001F,opus',
  'video/mp4;codecs=avc1,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const

export type RecordingContainer = 'mp4' | 'webm'

/**
 * The first candidate the browser can record. `forced` (test hook `forceRecordingMime`) keeps only the candidates that
 * start with it, for example `'video/webm'` or `'video/mp4'`. Null when nothing fits: the UI shows an error (decision).
 */
export function pickRecordingMime(isTypeSupported: (mime: string) => boolean, forced?: string | null): string | null {
  const prefix = forced?.trim().toLowerCase() || null
  for (const candidate of RECORDING_MIME_CANDIDATES) {
    if (prefix && !candidate.startsWith(prefix)) continue
    try {
      if (isTypeSupported(candidate)) return candidate
    } catch {
      // Some engines throw on MIME strings they cannot parse: treat as unsupported.
    }
  }
  return null
}

/** `video/mp4;codecs=…` → `mp4`; everything else this module picks is WebM. */
export function containerOf(mime: string): RecordingContainer {
  return mime.trim().toLowerCase().startsWith('video/mp4') ? 'mp4' : 'webm'
}

/** The MIME type without parameters (`video/webm`), for the saved Blob. */
export function baseMimeType(mime: string): string {
  return mime.split(';', 1)[0]!.trim().toLowerCase()
}
