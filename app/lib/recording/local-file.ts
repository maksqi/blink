/**
 * Local-only recordings: the raw MediaRecorder output is kept in memory and saved on this device when the recording
 * stops. Nothing is uploaded, so the recording stays end-to-end encrypted.
 */
import { baseMimeType, containerOf } from './mime'

/** A name reduced to `[a-z0-9-]` for file names (accents dropped, other characters become dashes); may be empty. */
export function fileNamePart(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .replace(/-$/, '')
}

/**
 * `blinq-<room>-<YYYY-MM-DD-HHmm>.<webm|mp4>` in local time. The room part is the first of `names` (e.g. the room name,
 * then the slug) that keeps any characters in `fileNamePart`, else `meeting`.
 */
export function localFileName(
  names: string | ReadonlyArray<string | null | undefined>,
  date: Date,
  mime: string,
): string {
  const candidates = typeof names === 'string' ? [names] : names
  let safeRoom = 'meeting'
  for (const name of candidates) {
    const part = name ? fileNamePart(name) : ''
    if (part) {
      safeRoom = part
      break
    }
  }
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
  return `blinq-${safeRoom}-${stamp}.${containerOf(mime)}`
}

/** How long the object URL stays alive after the download started (decision). */
export const REVOKE_AFTER_MS = 60_000

/** Saves the parts as one file through a temporary object URL, then revokes the URL. */
export function saveRecordingFile(
  parts: readonly Blob[],
  mime: string,
  fileName: string,
  doc: Document = document,
): Blob {
  const blob = new Blob(parts as Blob[], { type: baseMimeType(mime) })
  const url = URL.createObjectURL(blob)
  const link = doc.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  link.hidden = true
  doc.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS)
  return blob
}
