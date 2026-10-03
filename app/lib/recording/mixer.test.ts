import { describe, expect, it } from 'vitest'
import { buildMixSources, hostGain, RecordingMixer, type MixerAudioContext, type MixSource } from './mixer'

class FakeNode {
  readonly connections: FakeNode[] = []
  disconnected = false
  connect(target: FakeNode) {
    this.connections.push(target)
    return target
  }
  disconnect() {
    this.disconnected = true
  }
}

class FakeGain extends FakeNode {
  readonly gain = { value: 1 }
}

class FakeTrack {
  readyState: MediaStreamTrackState = 'live'
  stopped = false
  constructor(readonly id: string) {}
  stop() {
    this.stopped = true
    this.readyState = 'ended'
  }
}

class FakeDestination extends FakeNode {
  readonly output = new FakeTrack('mix')
  readonly stream = {
    getAudioTracks: () => [this.output],
    getTracks: () => [this.output],
  }
}

class FakeContext {
  state: AudioContextState = 'suspended'
  closed = false
  readonly sources: Array<{ node: FakeNode; tracks: FakeTrack[] }> = []
  readonly gains: FakeGain[] = []
  readonly destination = new FakeDestination()
  failNext = false

  createMediaStreamSource(stream: { tracks: FakeTrack[] }) {
    if (this.failNext) {
      this.failNext = false
      throw new Error('NotSupportedError')
    }
    const node = new FakeNode()
    this.sources.push({ node, tracks: stream.tracks })
    return node
  }
  createGain() {
    const gain = new FakeGain()
    this.gains.push(gain)
    return gain
  }
  createMediaStreamDestination() {
    return this.destination
  }
  async resume() {
    this.state = 'running'
  }
  async close() {
    this.closed = true
    this.state = 'closed'
  }
}

function mixer() {
  const context = new FakeContext()
  const errors: unknown[] = []
  const instance = new RecordingMixer({
    createContext: () => context as unknown as MixerAudioContext,
    createStream: (tracks) => ({ tracks }) as unknown as MediaStream,
    onError: (error) => errors.push(error),
  })
  return { context, instance, errors }
}

const track = (id: string) => new FakeTrack(id) as unknown as MediaStreamTrack
const source = (t: MediaStreamTrack, gain: number): MixSource => ({ id: t.id, track: t, gain })

describe('hostGain', () => {
  it('maps the host volume for everyone (0..100) to a linear gain', () => {
    expect(hostGain(100)).toBe(1)
    expect(hostGain(50)).toBe(0.5)
    expect(hostGain(0)).toBe(0)
    expect(hostGain(150)).toBe(1)
    expect(hostGain(-5)).toBe(0)
    expect(hostGain(undefined)).toBe(1)
    expect(hostGain(Number.NaN)).toBe(1)
  })
})

describe('buildMixSources', () => {
  it('uses vol / 100 per remote publisher and unity for the own mic', () => {
    const alice = track('a')
    const bob = track('b')
    const mic = track('mic')
    const volumes: Record<string, number> = { p_alice: 30, p_bob: 100 }
    const sources = buildMixSources(
      [
        { identity: 'p_alice', track: alice },
        { identity: 'p_bob', track: bob },
      ],
      (identity) => volumes[identity],
      mic,
    )
    expect(sources).toEqual([
      { id: 'a', track: alice, gain: 0.3 },
      { id: 'b', track: bob, gain: 1 },
      { id: 'mic', track: mic, gain: 1 },
    ])
  })

  it('mutes a participant the host set to 0 and treats an unknown volume as 100', () => {
    const sources = buildMixSources(
      [
        { identity: 'p_muted', track: track('m') },
        { identity: 'p_unknown', track: track('u') },
      ],
      (identity) => (identity === 'p_muted' ? 0 : undefined),
      null,
    )
    expect(sources.map((s) => s.gain)).toEqual([0, 1])
  })

  it('skips an ended own mic', () => {
    const mic = track('mic')
    ;(mic as unknown as FakeTrack).stop()
    expect(buildMixSources([], () => 100, mic)).toEqual([])
  })
})

describe('RecordingMixer', () => {
  it('connects each source through its own gain into one destination', () => {
    const { context, instance } = mixer()
    const a = track('a')
    const b = track('b')
    instance.sync([source(a, 0.25), source(b, 1)])
    expect(instance.sourceIds).toEqual(['a', 'b'])
    expect(context.sources.map((s) => s.tracks[0]?.id)).toEqual(['a', 'b'])
    expect(context.gains.map((g) => g.gain.value)).toEqual([0.25, 1])
    for (const [index, { node }] of context.sources.entries()) {
      expect(node.connections).toEqual([context.gains[index]])
      expect(context.gains[index]!.connections).toEqual([context.destination])
    }
    expect(instance.track?.id).toBe('mix')
  })

  it('updates gains in place when the host volume changes', () => {
    const { context, instance } = mixer()
    const a = track('a')
    instance.sync([source(a, 1)])
    instance.sync([source(a, 0.4)])
    expect(context.sources).toHaveLength(1)
    expect(instance.gainOf('a')).toBe(0.4)
  })

  it('disconnects sources that went away or ended and adds new ones', () => {
    const { context, instance } = mixer()
    const a = track('a')
    const b = track('b')
    instance.sync([source(a, 1), source(b, 1)])
    ;(b as unknown as FakeTrack).stop()
    const c = track('c')
    instance.sync([source(a, 1), source(b, 1), source(c, 1)])
    expect(instance.sourceIds).toEqual(['a', 'c'])
    expect(context.sources[1]!.node.disconnected).toBe(true)

    instance.sync([source(c, 1)])
    expect(instance.sourceIds).toEqual(['c'])
    expect(context.sources[0]!.node.disconnected).toBe(true)
  })

  it('reconnects when the same id carries a new track', () => {
    const { context, instance } = mixer()
    instance.sync([{ id: 'x', track: track('x'), gain: 1 }])
    instance.sync([{ id: 'x', track: track('x'), gain: 1 }])
    expect(context.sources).toHaveLength(2)
    expect(context.sources[0]!.node.disconnected).toBe(true)
  })

  it('clamps gains to 0..1', () => {
    const { instance } = mixer()
    instance.sync([source(track('a'), 3), source(track('b'), -1)])
    expect(instance.gainOf('a')).toBe(1)
    expect(instance.gainOf('b')).toBe(0)
  })

  it('keeps going when one source cannot be connected', () => {
    const { context, instance, errors } = mixer()
    context.failNext = true
    instance.sync([source(track('bad'), 1), source(track('good'), 1)])
    expect(instance.sourceIds).toEqual(['good'])
    expect(errors).toHaveLength(1)
  })

  it('resumes a suspended context and closes everything on dispose', async () => {
    const { context, instance } = mixer()
    await instance.resume()
    expect(context.state).toBe('running')
    instance.sync([source(track('a'), 1)])
    instance.dispose()
    expect(context.sources[0]!.node.disconnected).toBe(true)
    expect(context.destination.output.stopped).toBe(true)
    await Promise.resolve()
    expect(context.closed).toBe(true)
    instance.sync([source(track('late'), 1)])
    expect(context.sources).toHaveLength(1)
  })
})
