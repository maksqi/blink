import { describe, expect, it, vi } from 'vitest'
import {
  AudioEngine,
  clampMicGain,
  effectiveVolume,
  parseVolumeAttribute,
  type AttachableAudioTrack,
} from './audio-engine'

describe('parseVolumeAttribute', () => {
  it('parses "0".."100" and falls back to 100 for anything else', () => {
    expect(parseVolumeAttribute('0')).toBe(0)
    expect(parseVolumeAttribute('7')).toBe(7)
    expect(parseVolumeAttribute('25')).toBe(25)
    expect(parseVolumeAttribute('100')).toBe(100)
    for (const bad of [undefined, null, '', '101', '-1', '007', '50.5', ' 50', '1e2', 'abc']) {
      expect(parseVolumeAttribute(bad)).toBe(100)
    }
  })
})

describe('effectiveVolume', () => {
  it('multiplies the local volume by the host volume', () => {
    expect(effectiveVolume(1, 100)).toBe(1)
    expect(effectiveVolume(1, 25)).toBe(0.25)
    expect(effectiveVolume(0.5, 50)).toBe(0.25)
    expect(effectiveVolume(0, 100)).toBe(0)
    expect(effectiveVolume(1, 0)).toBe(0)
  })

  it('clamps out-of-range and invalid values', () => {
    expect(effectiveVolume(3, 100)).toBe(1)
    expect(effectiveVolume(1, 400)).toBe(1)
    expect(effectiveVolume(-1, 100)).toBe(0)
    expect(effectiveVolume(Number.NaN, 100)).toBe(0)
    expect(effectiveVolume(1, Number.NaN)).toBe(0)
  })
})

describe('clampMicGain', () => {
  it('keeps the gain within 0..2', () => {
    expect(clampMicGain(1)).toBe(1)
    expect(clampMicGain(1.5)).toBe(1.5)
    expect(clampMicGain(5)).toBe(2)
    expect(clampMicGain(-1)).toBe(0)
    expect(clampMicGain(Number.NaN)).toBe(1)
  })
})

class FakeElement {
  volume = 1
  autoplay = false
  srcObject: unknown = 'stream'
  dataset: Record<string, string> = {}
  attributes = new Map<string, string>()
  removed = false
  sinkId = ''
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }
  remove() {
    this.removed = true
  }
  play() {
    return Promise.resolve()
  }
  async setSinkId(id: string) {
    this.sinkId = id
  }
}

function fakeTrack(sid: string): AttachableAudioTrack & { attached: unknown[] } {
  const attached: unknown[] = []
  return {
    sid,
    attached,
    mediaStreamTrack: { id: `mst-${sid}`, readyState: 'live' } as MediaStreamTrack,
    attach: vi.fn((element: HTMLMediaElement) => {
      attached.push(element)
      return element
    }),
    detach: vi.fn((element: HTMLMediaElement) => {
      attached.splice(attached.indexOf(element), 1)
      return element
    }),
  }
}

function engine(hostVolumes: Record<string, number> = {}, blocked = new Set<string>()) {
  const elements: FakeElement[] = []
  const appended: unknown[] = []
  const setMicGain = vi.fn()
  const audio = new AudioEngine({
    createElement: () => {
      const element = new FakeElement()
      elements.push(element)
      return element as unknown as HTMLAudioElement
    },
    container: () => ({ append: (el: unknown) => appended.push(el) }) as unknown as HTMLElement,
    hostVolume: (identity) => hostVolumes[identity] ?? 100,
    setMicGain,
    blocked: (identity) => blocked.has(identity),
  })
  return { audio, elements, appended, setMicGain, hostVolumes, blocked }
}

describe('AudioEngine', () => {
  it('plays each encrypted track through its own attached element', () => {
    const { audio, elements, appended } = engine()
    const a = fakeTrack('TR_a')
    const b = fakeTrack('TR_b')
    audio.addTrack('p_alice', 'microphone', a, true)
    audio.addTrack('p_alice', 'screen_share_audio', b, true)
    expect(elements).toHaveLength(2)
    expect(appended).toHaveLength(2)
    expect(a.attached).toEqual([elements[0]])
    expect(elements[0]!.autoplay).toBe(true)
    expect(audio.remoteAudioTracks().map((t) => t.id)).toEqual(['mst-TR_a', 'mst-TR_b'])
  })

  it('refuses tracks of unencrypted publications', () => {
    const { audio, elements } = engine()
    audio.addTrack('p_mallory', 'microphone', fakeTrack('TR_m'), false)
    expect(elements).toHaveLength(0)
    expect(audio.remoteAudioTracks()).toEqual([])
  })

  it('never plays or hands out the audio of a blocked participant, even from encrypted publications', () => {
    const { audio, elements, blocked } = engine()
    audio.addTrack('p_x', 'microphone', fakeTrack('TR_x1'), true)
    audio.addTrack('p_alice', 'microphone', fakeTrack('TR_a'), true)
    // p_x published something unencrypted: the session blocks the participant and drops their audio.
    blocked.add('p_x')
    expect(audio.remoteAudioTracks().map((t) => t.id)).toEqual(['mst-TR_a'])
    audio.removeIdentity('p_x')
    expect(elements[0]!.removed).toBe(true)
    expect(elements[1]!.removed).toBe(false)
    audio.addTrack('p_x', 'screen_share_audio', fakeTrack('TR_x2'), true)
    expect(elements).toHaveLength(2)
    expect(audio.snapshot()).toEqual({ p_alice: expect.any(Object) })
  })

  it('applies local volume × host volume and follows changes of either', () => {
    const { audio, elements, hostVolumes } = engine({ p_alice: 50 })
    audio.addTrack('p_alice', 'microphone', fakeTrack('TR_a'), true)
    expect(elements[0]!.volume).toBe(0.5)
    audio.setLocalVolume('p_alice', 0.5)
    expect(elements[0]!.volume).toBe(0.25)
    expect(audio.getLocalVolume('p_alice')).toBe(0.5)
    hostVolumes.p_alice = 100
    audio.refreshVolumes()
    expect(elements[0]!.volume).toBe(0.5)
    audio.setLocalVolume('p_alice', 7)
    expect(audio.getLocalVolume('p_alice')).toBe(1)
    expect(audio.getLocalVolume('p_unknown')).toBe(1)
    expect(audio.snapshot()).toEqual({ p_alice: { localVolume: 1, hostVolume: 100, elementVolume: 1, tracks: 1 } })
  })

  it('keeps the element attached until the track is removed, then cleans up', () => {
    const { audio, elements } = engine()
    const track = fakeTrack('TR_a')
    audio.addTrack('p_alice', 'microphone', track, true)
    audio.addTrack('p_alice', 'microphone', track, true) // idempotent
    expect(elements).toHaveLength(1)
    audio.removeTrack('TR_a')
    expect(track.attached).toEqual([])
    expect(elements[0]!.removed).toBe(true)
    expect(elements[0]!.srcObject).toBeNull()
    expect(audio.remoteAudioTracks()).toEqual([])
  })

  it('routes every element to the selected output device', async () => {
    const { audio, elements } = engine()
    audio.addTrack('p_alice', 'microphone', fakeTrack('TR_a'), true)
    await audio.setOutputDevice('speaker-2')
    audio.addTrack('p_bob', 'microphone', fakeTrack('TR_b'), true)
    await Promise.resolve()
    expect(elements.map((e) => e.sinkId)).toEqual(['speaker-2', 'speaker-2'])
  })

  it('clamps the mic gain before handing it to the mic chain', () => {
    const { audio, setMicGain } = engine()
    audio.setMicGain(9)
    expect(setMicGain).toHaveBeenCalledWith(2)
  })

  it('removes everything on dispose', () => {
    const { audio, elements } = engine()
    audio.addTrack('p_alice', 'microphone', fakeTrack('TR_a'), true)
    audio.addTrack('p_bob', 'microphone', fakeTrack('TR_b'), true)
    audio.dispose()
    expect(elements.every((e) => e.removed)).toBe(true)
    expect(audio.remoteAudioTracks()).toEqual([])
  })
})
