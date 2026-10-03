/**
 * Remembered effect choices in localStorage `blinq:media:v1` (pure helpers over an injectable storage).
 *
 * - Blur is remembered per camera `deviceId`; noise suppression and mic gain per microphone `deviceId`.
 * - A browser-wide default covers devices without an entry (decision): every choice also updates it, so a new device
 *   starts with the latest choice. Unknown device ids (no permission yet) only update the default.
 * - Read is zod-validated entry by entry: garbage is ignored, valid entries survive. Every storage access is guarded
 *   (private modes throw); without storage the choices last for the page only.
 * - At most MAX_DEVICES entries per kind are kept, the least recently changed are dropped first.
 * - Device ids are per-origin random strings; labels are never stored.
 */
import { z } from 'zod'
import type { PrefsStorage } from '../call/devices'
import {
  BLUR_LEVELS,
  MIC_GAIN_MAX,
  MIC_GAIN_MIN,
  NOISE_MODES,
  type BlurLevel,
  type BlurOnLevel,
  type NoiseMode,
} from './levels'

export const MEDIA_PREFS_KEY = 'blinq:media:v1'
export const MAX_DEVICES = 16

export interface MicPrefs {
  noise: NoiseMode
  gain: number
}

export interface MediaDefaults extends MicPrefs {
  blur: BlurLevel
  /** The level "Blur background" turns on (the last non-off level chosen). */
  lastBlur: BlurOnLevel
}

export interface MediaPrefs {
  defaults: MediaDefaults
  /** Least recently changed first. */
  cameras: Array<{ id: string; blur: BlurLevel }>
  mics: Array<{ id: string } & MicPrefs>
}

export const DEFAULT_MEDIA_DEFAULTS: Readonly<MediaDefaults> = Object.freeze({
  blur: 'off',
  noise: 'browser',
  gain: 1,
  lastBlur: 'strong',
})

export function emptyMediaPrefs(): MediaPrefs {
  return { defaults: { ...DEFAULT_MEDIA_DEFAULTS }, cameras: [], mics: [] }
}

const blurSchema = z.enum(BLUR_LEVELS)
const noiseSchema = z.enum(NOISE_MODES)
const gainSchema = z.number().min(MIC_GAIN_MIN).max(MIC_GAIN_MAX)
const deviceIdSchema = z.string().min(1).max(512)
const cameraSchema = z.object({ id: deviceIdSchema, blur: blurSchema })
const micSchema = z.object({ id: deviceIdSchema, noise: noiseSchema, gain: gainSchema })

function pick<T>(schema: z.ZodType<T>, value: unknown, fallback: T): T {
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : fallback
}

function entries<T extends { id: string }>(schema: z.ZodType<T>, value: unknown): T[] {
  if (!Array.isArray(value)) return []
  const byId = new Map<string, T>()
  for (const item of value) {
    const parsed = schema.safeParse(item)
    if (!parsed.success) continue
    byId.delete(parsed.data.id) // a later duplicate wins and moves to the end
    byId.set(parsed.data.id, parsed.data)
  }
  return [...byId.values()].slice(-MAX_DEVICES)
}

/** Validates a parsed document field by field; anything invalid falls back to the default. */
export function parseMediaPrefs(value: unknown): MediaPrefs {
  const prefs = emptyMediaPrefs()
  if (typeof value !== 'object' || value === null) return prefs
  const doc = value as Record<string, unknown>
  const defaults = (typeof doc.defaults === 'object' && doc.defaults !== null ? doc.defaults : {}) as Record<
    string,
    unknown
  >
  prefs.defaults = {
    blur: pick(blurSchema, defaults.blur, DEFAULT_MEDIA_DEFAULTS.blur),
    noise: pick(noiseSchema, defaults.noise, DEFAULT_MEDIA_DEFAULTS.noise),
    gain: pick(gainSchema, defaults.gain, DEFAULT_MEDIA_DEFAULTS.gain),
    lastBlur: pick(z.enum(['light', 'strong']), defaults.lastBlur, DEFAULT_MEDIA_DEFAULTS.lastBlur),
  }
  prefs.cameras = entries(cameraSchema, doc.cameras)
  prefs.mics = entries(micSchema, doc.mics)
  return prefs
}

export function readMediaPrefs(storage: PrefsStorage | null | undefined): MediaPrefs {
  try {
    const raw = storage?.getItem(MEDIA_PREFS_KEY)
    if (!raw) return emptyMediaPrefs()
    return parseMediaPrefs(JSON.parse(raw))
  } catch {
    return emptyMediaPrefs()
  }
}

/** Returns false when the storage refused the write (the choice then lasts for this page only). */
export function writeMediaPrefs(storage: PrefsStorage | null | undefined, prefs: MediaPrefs): boolean {
  try {
    if (!storage) return false
    storage.setItem(MEDIA_PREFS_KEY, JSON.stringify(prefs))
    return true
  } catch {
    return false
  }
}

const known = (deviceId: string | null | undefined): deviceId is string =>
  typeof deviceId === 'string' && deviceIdSchema.safeParse(deviceId).success

/** Blur for a camera: its own entry, else the browser-wide default. */
export function blurFor(prefs: MediaPrefs, deviceId: string | null | undefined): BlurLevel {
  const entry = known(deviceId) ? prefs.cameras.find((camera) => camera.id === deviceId) : undefined
  return entry?.blur ?? prefs.defaults.blur
}

/** Noise mode and gain for a microphone: its own entry, else the browser-wide default. */
export function micPrefsFor(prefs: MediaPrefs, deviceId: string | null | undefined): MicPrefs {
  const entry = known(deviceId) ? prefs.mics.find((mic) => mic.id === deviceId) : undefined
  return entry ? { noise: entry.noise, gain: entry.gain } : { noise: prefs.defaults.noise, gain: prefs.defaults.gain }
}

function upsert<T extends { id: string }>(list: T[], entry: T): T[] {
  return [...list.filter((item) => item.id !== entry.id), entry].slice(-MAX_DEVICES)
}

/** Remembers `blur` for the camera (when known) and as the default. Pure: returns a new object. */
export function rememberBlur(prefs: MediaPrefs, deviceId: string | null | undefined, blur: BlurLevel): MediaPrefs {
  return {
    defaults: { ...prefs.defaults, blur, lastBlur: blur === 'off' ? prefs.defaults.lastBlur : blur },
    cameras: known(deviceId) ? upsert(prefs.cameras, { id: deviceId, blur }) : prefs.cameras,
    mics: prefs.mics,
  }
}

/** Remembers noise mode and/or gain for the microphone (when known) and as the default. Pure. */
export function rememberMic(
  prefs: MediaPrefs,
  deviceId: string | null | undefined,
  patch: Partial<MicPrefs>,
): MediaPrefs {
  const next = { ...micPrefsFor(prefs, deviceId), ...patch }
  return {
    defaults: { ...prefs.defaults, ...patch },
    cameras: prefs.cameras,
    mics: known(deviceId) ? upsert(prefs.mics, { id: deviceId, ...next }) : prefs.mics,
  }
}
