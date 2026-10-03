import { describe, expect, it } from 'vitest'
import type { PrefsStorage } from '../call/devices'
import {
  blurFor,
  DEFAULT_MEDIA_DEFAULTS,
  emptyMediaPrefs,
  MAX_DEVICES,
  MEDIA_PREFS_KEY,
  micPrefsFor,
  parseMediaPrefs,
  readMediaPrefs,
  rememberBlur,
  rememberMic,
  writeMediaPrefs,
} from './preferences'

function memoryStorage(initial: Record<string, string> = {}): PrefsStorage & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value
    },
  }
}

const throwing: PrefsStorage = {
  getItem: () => {
    throw new DOMException('denied', 'SecurityError')
  },
  setItem: () => {
    throw new DOMException('quota', 'QuotaExceededError')
  },
}

describe('defaults', () => {
  it('are blur off, browser noise suppression and gain 1', () => {
    const prefs = readMediaPrefs(memoryStorage())
    expect(prefs.defaults).toEqual({ blur: 'off', noise: 'browser', gain: 1, lastBlur: 'strong' })
    expect(blurFor(prefs, 'cam-1')).toBe('off')
    expect(micPrefsFor(prefs, 'mic-1')).toEqual({ noise: 'browser', gain: 1 })
    expect(blurFor(prefs, null)).toBe('off')
  })
})

describe('per-device keys', () => {
  it('remembers blur per camera and noise/gain per microphone', () => {
    let prefs = emptyMediaPrefs()
    prefs = rememberBlur(prefs, 'cam-1', 'strong')
    prefs = rememberMic(prefs, 'mic-1', { noise: 'rnnoise' })
    prefs = rememberMic(prefs, 'mic-1', { gain: 1.5 })
    prefs = rememberMic(prefs, 'mic-2', { noise: 'off', gain: 0.5 })
    prefs = rememberBlur(prefs, 'cam-2', 'light')

    expect(blurFor(prefs, 'cam-1')).toBe('strong')
    expect(blurFor(prefs, 'cam-2')).toBe('light')
    expect(micPrefsFor(prefs, 'mic-1')).toEqual({ noise: 'rnnoise', gain: 1.5 })
    expect(micPrefsFor(prefs, 'mic-2')).toEqual({ noise: 'off', gain: 0.5 })
  })

  it('uses the latest choice as the default for unknown devices (decision)', () => {
    let prefs = rememberBlur(emptyMediaPrefs(), 'cam-1', 'light')
    prefs = rememberMic(prefs, 'mic-1', { noise: 'off', gain: 1.25 })
    expect(blurFor(prefs, 'cam-new')).toBe('light')
    expect(micPrefsFor(prefs, 'mic-new')).toEqual({ noise: 'off', gain: 1.25 })
    // A device keeps its own choice when the default moves on.
    prefs = rememberBlur(prefs, 'cam-2', 'off')
    expect(blurFor(prefs, 'cam-1')).toBe('light')
    expect(blurFor(prefs, 'cam-new')).toBe('off')
  })

  it('only updates the default for unknown device ids', () => {
    let prefs = rememberBlur(emptyMediaPrefs(), null, 'strong')
    prefs = rememberMic(prefs, '', { noise: 'rnnoise' })
    expect(prefs.cameras).toEqual([])
    expect(prefs.mics).toEqual([])
    expect(prefs.defaults).toMatchObject({ blur: 'strong', noise: 'rnnoise' })
  })

  it('keeps a patch-less field of a new mic entry from the default', () => {
    const prefs = rememberMic(rememberMic(emptyMediaPrefs(), null, { gain: 0.75 }), 'mic-1', { noise: 'off' })
    expect(micPrefsFor(prefs, 'mic-1')).toEqual({ noise: 'off', gain: 0.75 })
  })

  it('remembers the last non-off blur level for the toggle', () => {
    let prefs = rememberBlur(emptyMediaPrefs(), 'cam-1', 'light')
    prefs = rememberBlur(prefs, 'cam-1', 'off')
    expect(prefs.defaults.lastBlur).toBe('light')
    prefs = rememberBlur(prefs, 'cam-1', 'strong')
    expect(prefs.defaults.lastBlur).toBe('strong')
  })

  it('keeps at most MAX_DEVICES entries per kind, dropping the least recently changed', () => {
    let prefs = emptyMediaPrefs()
    for (let i = 0; i < MAX_DEVICES + 3; i++) prefs = rememberBlur(prefs, `cam-${i}`, 'light')
    prefs = rememberBlur(prefs, 'cam-3', 'strong') // touched again: moves to the end
    expect(prefs.cameras).toHaveLength(MAX_DEVICES)
    expect(prefs.cameras.map((c) => c.id)).not.toContain('cam-0')
    expect(prefs.cameras.at(-1)).toEqual({ id: 'cam-3', blur: 'strong' })
  })

  it('does not mutate its input', () => {
    const prefs = emptyMediaPrefs()
    const snapshot = structuredClone(prefs)
    rememberBlur(prefs, 'cam-1', 'strong')
    rememberMic(prefs, 'mic-1', { noise: 'off', gain: 2 })
    expect(prefs).toEqual(snapshot)
  })
})

describe('storage', () => {
  it('round-trips through the storage key', () => {
    const storage = memoryStorage()
    const prefs = rememberMic(rememberBlur(emptyMediaPrefs(), 'cam-1', 'strong'), 'mic-1', { noise: 'off', gain: 2 })
    expect(writeMediaPrefs(storage, prefs)).toBe(true)
    expect(Object.keys(storage.data)).toEqual([MEDIA_PREFS_KEY])
    expect(readMediaPrefs(storage)).toEqual(prefs)
  })

  it('ignores invalid JSON and non-objects', () => {
    expect(readMediaPrefs(memoryStorage({ [MEDIA_PREFS_KEY]: '{not json' }))).toEqual(emptyMediaPrefs())
    expect(readMediaPrefs(memoryStorage({ [MEDIA_PREFS_KEY]: '42' }))).toEqual(emptyMediaPrefs())
    expect(readMediaPrefs(memoryStorage({ [MEDIA_PREFS_KEY]: 'null' }))).toEqual(emptyMediaPrefs())
    expect(readMediaPrefs(memoryStorage({ [MEDIA_PREFS_KEY]: '[]' }))).toEqual(emptyMediaPrefs())
  })

  it('drops invalid fields and entries but keeps the valid ones', () => {
    const raw = JSON.stringify({
      defaults: { blur: 'max', noise: 'rnnoise', gain: 9, lastBlur: 'off' },
      cameras: [{ id: 'cam-1', blur: 'light' }, { id: 'cam-2', blur: 'huge' }, { id: '', blur: 'off' }, 'junk', null],
      mics: [
        { id: 'mic-1', noise: 'off', gain: 1.5 },
        { id: 'mic-2', noise: 'off', gain: -1 },
        { id: 'mic-3', noise: 'krisp', gain: 1 },
        { id: 'mic-4', noise: 'off', gain: '1' },
        { id: 'x'.repeat(600), noise: 'off', gain: 1 },
      ],
      extra: { ignored: true },
    })
    const prefs = readMediaPrefs(memoryStorage({ [MEDIA_PREFS_KEY]: raw }))
    expect(prefs.defaults).toEqual({ ...DEFAULT_MEDIA_DEFAULTS, noise: 'rnnoise' })
    expect(prefs.cameras).toEqual([{ id: 'cam-1', blur: 'light' }])
    expect(prefs.mics).toEqual([{ id: 'mic-1', noise: 'off', gain: 1.5 }])
  })

  it('deduplicates entries (the later one wins) and caps oversized lists', () => {
    const cameras = Array.from({ length: MAX_DEVICES + 5 }, (_, i) => ({ id: `cam-${i}`, blur: 'light' }))
    cameras.push({ id: 'cam-20', blur: 'strong' })
    const prefs = parseMediaPrefs({ cameras })
    expect(prefs.cameras).toHaveLength(MAX_DEVICES)
    expect(prefs.cameras.filter((c) => c.id === 'cam-20')).toEqual([{ id: 'cam-20', blur: 'strong' }])
  })

  it('survives a storage that throws on every access', () => {
    expect(readMediaPrefs(throwing)).toEqual(emptyMediaPrefs())
    expect(writeMediaPrefs(throwing, emptyMediaPrefs())).toBe(false)
    expect(readMediaPrefs(null)).toEqual(emptyMediaPrefs())
    expect(writeMediaPrefs(null, emptyMediaPrefs())).toBe(false)
  })
})
