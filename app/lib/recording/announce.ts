/**
 * What everyone in the call is told when the REC indicator changes (toast and screen-reader text), the indicator's
 * disclosure per mode and the elapsed-time format. Pure.
 */
export interface IndicatorState {
  by: string
  mode: 'server' | 'local'
  startedAt: string
}

export function recordingAnnouncement(
  previous: Pick<IndicatorState, 'by' | 'startedAt'> | null | undefined,
  next: Pick<IndicatorState, 'by' | 'startedAt'> | null | undefined,
  options: { initial: boolean; own: boolean },
): string | null {
  if (next && options.initial) return 'This meeting is being recorded.'
  if (next && (!previous || previous.startedAt !== next.startedAt)) {
    return options.own ? 'You started recording. Everyone in the meeting can see it.' : `${next.by} started recording.`
  }
  if (!next && previous) return 'Recording stopped.'
  return null
}

/** Server recordings are readable by the server and its admins (docs/SECURITY.md §6): the indicator says so. */
export const SERVER_DISCLOSURE =
  'The recording is uploaded and stored encrypted on the server; the server and its admins can decrypt it.'
export const LOCAL_DISCLOSURE = 'The file stays on this device and is never uploaded.'
export const EVERYONE_SEES = 'Everyone in the meeting will see that you are recording.'

/** Tooltip text of the REC indicator per mode. */
export function indicatorDisclosure(state: Pick<IndicatorState, 'by' | 'mode'>): string {
  return state.mode === 'server' ? SERVER_DISCLOSURE : `Recording on ${state.by}'s device`
}

/** `m:ss` or `h:mm:ss` for a duration in milliseconds (negative clamps to 0). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`
}
