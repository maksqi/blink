/**
 * Media device lists and the remembered device per kind (pure helpers plus a storage wrapper).
 * Preferences live in localStorage `blinq:devices:v1`, are zod-validated on read and every access is guarded
 * (private modes throw). They hold device ids only, never labels.
 */
import { z } from 'zod'

export type DeviceKind = 'audioinput' | 'videoinput' | 'audiooutput'

export interface DeviceOption {
  deviceId: string
  label: string
  groupId: string
}

export type DeviceLists = Record<DeviceKind, DeviceOption[]>

export type DevicePermission = 'granted' | 'denied' | 'prompt' | 'unknown'

const FALLBACK_LABEL: Record<DeviceKind, string> = {
  audioinput: 'Microphone',
  videoinput: 'Camera',
  audiooutput: 'Speaker',
}

export function emptyDeviceLists(): DeviceLists {
  return { audioinput: [], videoinput: [], audiooutput: [] }
}

/**
 * Groups `enumerateDevices()` output by kind. Entries without an id (no permission yet) are dropped; missing labels
 * become "Camera 2" style names so the pickers never show blanks.
 */
export function toDeviceLists(devices: ReadonlyArray<Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label' | 'groupId'>>): DeviceLists {
  const lists = emptyDeviceLists()
  for (const device of devices) {
    const kind = device.kind as DeviceKind
    if (!(kind in lists) || !device.deviceId) continue
    const list = lists[kind]
    if (list.some((existing) => existing.deviceId === device.deviceId)) continue
    const label = device.label.trim() || `${FALLBACK_LABEL[kind]} ${list.length + 1}`
    list.push({ deviceId: device.deviceId, label, groupId: device.groupId })
  }
  return lists
}

/** The device to use: the preferred one if it still exists, else the current one, else the first (or undefined). */
export function pickDevice(
  options: readonly DeviceOption[],
  preferred?: string | null,
  current?: string | null,
): string | undefined {
  if (preferred && options.some((option) => option.deviceId === preferred)) return preferred
  if (current && options.some((option) => option.deviceId === current)) return current
  return options[0]?.deviceId
}

export const DEVICE_PREFS_KEY = 'blinq:devices:v1'

const prefsSchema = z
  .object({
    audioinput: z.string().max(512).optional(),
    videoinput: z.string().max(512).optional(),
    audiooutput: z.string().max(512).optional(),
  })
  .partial()

export type DevicePrefs = z.infer<typeof prefsSchema>

export interface PrefsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function readDevicePrefs(storage: PrefsStorage | null | undefined): DevicePrefs {
  try {
    const raw = storage?.getItem(DEVICE_PREFS_KEY)
    if (!raw) return {}
    const parsed = prefsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

export function writeDevicePref(storage: PrefsStorage | null | undefined, kind: DeviceKind, deviceId: string): void {
  try {
    const prefs = { ...readDevicePrefs(storage), [kind]: deviceId }
    storage?.setItem(DEVICE_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
}

/** `localStorage`, or null when the browser refuses access. */
export function browserStorage(): PrefsStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** Maps getUserMedia failures to what the UI explains. */
export type CaptureError = 'denied' | 'not-found' | 'in-use' | 'failed'

export function captureErrorOf(error: unknown): CaptureError {
  const name = typeof error === 'object' && error !== null ? (error as { name?: string }).name : undefined
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied'
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'DevicesNotFoundError':
      return 'not-found'
    case 'NotReadableError':
    case 'AbortError':
    case 'TrackStartError':
      return 'in-use'
    default:
      return 'failed'
  }
}

export const CAPTURE_ERROR_TEXT: Record<'camera' | 'microphone', Record<CaptureError, string>> = {
  camera: {
    denied: "Camera access is blocked. Allow it in your browser's site settings, then reload.",
    'not-found': 'No camera found. Connect one or join without video.',
    'in-use': 'Your camera is used by another app. Close it and try again.',
    failed: 'The camera could not start. Try another camera.',
  },
  microphone: {
    denied: "Microphone access is blocked. Allow it in your browser's site settings, then reload.",
    'not-found': 'No microphone found. Connect one or join without audio.',
    'in-use': 'Your microphone is used by another app. Close it and try again.',
    failed: 'The microphone could not start. Try another microphone.',
  },
}
