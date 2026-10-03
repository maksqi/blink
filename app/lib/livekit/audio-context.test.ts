import { describe, expect, it, vi } from 'vitest'
import type { MicInsert } from '../contracts/call'
import { MicChain } from './audio-context'

class FakeNode {
  readonly connect = vi.fn((node: unknown) => node)
  readonly disconnect = vi.fn()
  readonly gain = { value: 1, setTargetAtTime: vi.fn() }
  fftSize = 0
}

function fakeContext() {
  const output = { stop: vi.fn(), kind: 'audio' }
  const context = {
    currentTime: 0,
    createGain: () => new FakeNode(),
    createAnalyser: () => new FakeNode(),
    createMediaStreamDestination: () => Object.assign(new FakeNode(), { stream: { getAudioTracks: () => [output] } }),
    createMediaStreamSource: () => new FakeNode(),
  }
  return { context: context as unknown as AudioContext, output }
}

describe('MicChain.destroy (F-049)', () => {
  it('stops its output track and disposes the insert', async () => {
    const { context, output } = fakeContext()
    const chain = new MicChain(context)
    const insert: MicInsert = {
      id: 'test-insert',
      connect: vi.fn(async (_context: AudioContext, input: AudioNode) => input),
      dispose: vi.fn(),
    }
    await chain.setInsert(insert)
    expect(chain.processedTrack).toBe(output)
    await chain.destroy()
    expect(output.stop).toHaveBeenCalledTimes(1)
    expect(insert.dispose).toHaveBeenCalledTimes(1)
  })
})
