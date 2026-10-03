/**
 * Microphone and camera changes started by buttons and hotkeys (F-042). Opening a device can fail (access blocked,
 * device busy or unplugged): LocalMedia records the reason in `store.media`, and `changeMedia` shows it through
 * `notify`, so a click or key press never leaves a rejected promise behind.
 */
import type { LocalMediaStatus } from '../livekit/local-media'
import { CAPTURE_ERROR_TEXT } from './devices'

export type MediaKind = 'microphone' | 'camera'

export const MEDIA_CHANGE_FAILED: Record<MediaKind, string> = {
  microphone: "Your microphone didn't change. Try again.",
  camera: "Your camera didn't change. Try again.",
}

type MediaErrors = Pick<LocalMediaStatus, 'micError' | 'cameraError'>

/** The text for a failed change: the capture error LocalMedia recorded, else a generic one. */
export function mediaErrorText(kind: MediaKind, media: MediaErrors): string {
  const reason = kind === 'microphone' ? media.micError : media.cameraError
  return reason ? CAPTURE_ERROR_TEXT[kind][reason] : MEDIA_CHANGE_FAILED[kind]
}

/** Runs a microphone or camera change; a failure goes to `notify` instead of rejecting. */
export async function changeMedia(
  kind: MediaKind,
  change: () => Promise<void>,
  media: () => MediaErrors,
  notify: (message: string) => void,
): Promise<void> {
  try {
    await change()
  } catch {
    notify(mediaErrorText(kind, media()))
  }
}
