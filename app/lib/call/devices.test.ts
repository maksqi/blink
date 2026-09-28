import { describe, expect, it } from 'vitest'
import {
  captureErrorOf,
  DEVICE_PREFS_KEY,
  pickDevice,
  readDevicePrefs,
  toDeviceLists,
  writeDevicePref,
  type PrefsStorage,
} from './devices'

const device = (kind: MediaDeviceKind, deviceId: string, label = '', groupId = 'g') => ({ kind, deviceId, label, groupId })

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

describe('toDeviceLists', () => {
  it('groups by kind, drops entries without ids and deduplicates', () => {
    const lists = toDeviceLists([
      device('videoinput', 'cam-1', 'FaceTime HD Camera'),
      device('audioinput', 'default', 'Default - MacBook Microphone'),
      device('audioinput', 'mic-2', 'USB Microphone'),
      device('audioinput', 'mic-2', 'USB Microphone'),
      device('audiooutput', '', ''),
      device('audiooutput', 'spk-1', 'Speakers'),
    ])
    expect(lists.videoinput.map((d) => d.deviceId)).toEqual(['cam-1'])
    expect(lists.audioinput.map((d) => d.label)).toEqual(['Default - MacBook Microphone', 'USB Microphone'])
    expect(lists.audiooutput.map((d) => d.deviceId)).toEqual(['spk-1'])
  })

  it('names unlabeled devices before permission is granted', () => {
    const lists = toDeviceLists([device('videoinput', 'a'), device('videoinput', 'b'), device('audioinput', 'c', '  ')])
    expect(lists.videoinput.map((d) => d.label)).toEqual(['Camera 1', 'Camera 2'])
    expect(lists.audioinput.map((d) => d.label)).toEqual(['Microphone 1'])
  })
})

describe('pickDevice', () => {
  const options = toDeviceLists([device('videoinput', 'a', 'A'), device('videoinput', 'b', 'B')]).videoinput

  it('prefers the remembered device, then the current one, then the first', () => {
    expect(pickDevice(options, 'b', 'a')).toBe('b')
    expect(pickDevice(options, 'gone', 'a')).toBe('a')
    expect(pickDevice(options, 'gone', 'also-gone')).toBe('a')
    expect(pickDevice([], 'b')).toBeUndefined()
  })
})

describe('device preferences', () => {
  it('remembers one device per kind', () => {
    const storage = memoryStorage()
    writeDevicePref(storage, 'videoinput', 'cam-1')
    writeDevicePref(storage, 'audioinput', 'mic-1')
    writeDevicePref(storage, 'videoinput', 'cam-2')
    expect(readDevicePrefs(storage)).toEqual({ videoinput: 'cam-2', audioinput: 'mic-1' })
  })

  it('ignores garbage and storage that throws', () => {
    expect(readDevicePrefs(memoryStorage({ [DEVICE_PREFS_KEY]: 'not json' }))).toEqual({})
    expect(readDevicePrefs(memoryStorage({ [DEVICE_PREFS_KEY]: '{"videoinput":42}' }))).toEqual({})
    expect(readDevicePrefs(null)).toEqual({})
    const throwing: PrefsStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(readDevicePrefs(throwing)).toEqual({})
    expect(() => writeDevicePref(throwing, 'audioinput', 'x')).not.toThrow()
  })
})

describe('captureErrorOf', () => {
  it('maps getUserMedia errors', () => {
    expect(captureErrorOf({ name: 'NotAllowedError' })).toBe('denied')
    expect(captureErrorOf({ name: 'NotFoundError' })).toBe('not-found')
    expect(captureErrorOf({ name: 'OverconstrainedError' })).toBe('not-found')
    expect(captureErrorOf({ name: 'NotReadableError' })).toBe('in-use')
    expect(captureErrorOf(new Error('x'))).toBe('failed')
    expect(captureErrorOf(null)).toBe('failed')
  })
})
