import { describe, expect, it, vi } from 'vitest'
import {
  assertRnnoiseSampleRate,
  createRnnoiseInsert,
  ensureRnnoiseWorklet,
  RnnoiseProcessorError,
  RnnoiseUnavailableError,
  type RnnoiseNode,
} from './rnnoise'

function fakeContext(sampleRate = 48_000, addModule = vi.fn(async (_url: string) => undefined)) {
  return { sampleRate, audioWorklet: { addModule } } as unknown as AudioContext & {
    audioWorklet: { addModule: typeof addModule }
  }
}

function fakeNode(context: BaseAudioContext) {
  const listeners = new Map<string, () => void>()
  return {
    context,
    connect: vi.fn(),
    disconnect: vi.fn(),
    addEventListener: vi.fn((type: string, listener: () => void) => listeners.set(type, listener)),
    removeEventListener: vi.fn((type: string) => listeners.delete(type)),
    fire: (type: string) => listeners.get(type)?.(),
  }
}

const fakeInput = () => ({ connect: vi.fn() }) as unknown as AudioNode & { connect: ReturnType<typeof vi.fn> }

function setup() {
  const nodes: Array<ReturnType<typeof fakeNode>> = []
  const onError = vi.fn()
  const forgetNode = vi.fn()
  const getNode = vi.fn(async (context: BaseAudioContext) => {
    const node = fakeNode(context)
    nodes.push(node)
    return node as unknown as RnnoiseNode
  })
  const insert = createRnnoiseInsert({ onError, getNode, forgetNode })
  return { insert, nodes, onError, getNode, forgetNode }
}

describe('assertRnnoiseSampleRate', () => {
  it('accepts only 48 kHz', () => {
    expect(() => assertRnnoiseSampleRate(fakeContext(48_000))).not.toThrow()
    expect(() => assertRnnoiseSampleRate(fakeContext(44_100))).toThrow(RnnoiseUnavailableError)
  })
})

describe('ensureRnnoiseWorklet', () => {
  it('adds the same-origin worklet module once per context and retries after a failure', async () => {
    const addModule = vi.fn(async (_url: string) => undefined)
    const context = fakeContext(48_000, addModule)
    await Promise.all([ensureRnnoiseWorklet(context), ensureRnnoiseWorklet(context)])
    expect(addModule).toHaveBeenCalledTimes(1)
    expect(addModule).toHaveBeenCalledWith('/vendor/rnnoise/workletProcessor.js')

    const failing = fakeContext(
      48_000,
      vi.fn(async () => {
        throw new Error('blocked')
      }),
    )
    await expect(ensureRnnoiseWorklet(failing)).rejects.toThrow('blocked')
    await expect(ensureRnnoiseWorklet(failing)).rejects.toThrow('blocked')
    expect(failing.audioWorklet.addModule).toHaveBeenCalledTimes(2)
  })
})

describe('createRnnoiseInsert', () => {
  it('puts the RNNoise node between the input and the gain stage', async () => {
    const { insert, nodes, onError } = setup()
    const context = fakeContext()
    const input = fakeInput()
    const output = await insert.connect(context, input)
    expect(output).toBe(nodes[0])
    expect(input.connect).toHaveBeenCalledWith(nodes[0])
    expect(insert.active).toBe(true)
    expect(insert.id).toBe('rnnoise')
    expect(onError).not.toHaveBeenCalled()
  })

  it('reconnects cleanly after a mic restart, reusing the node of the same context', async () => {
    const { insert, nodes, getNode } = setup()
    const context = fakeContext()
    await insert.connect(context, fakeInput())
    const second = fakeInput()
    expect(await insert.connect(context, second)).toBe(nodes[0])
    expect(second.connect).toHaveBeenCalledWith(nodes[0])
    expect(getNode).toHaveBeenCalledTimes(1)
  })

  it('moves to a new node when the chain moved to another context', async () => {
    const { insert, nodes } = setup()
    await insert.connect(fakeContext(), fakeInput())
    const other = fakeContext()
    expect(await insert.connect(other, fakeInput())).toBe(nodes[1])
    expect(nodes[0]!.disconnect).toHaveBeenCalled()
  })

  it('passes audio through and reports when the context is not 48 kHz', async () => {
    const { insert, onError, getNode } = setup()
    const input = fakeInput()
    expect(await insert.connect(fakeContext(44_100), input)).toBe(input)
    expect(getNode).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.any(RnnoiseUnavailableError))
    expect(insert.active).toBe(false)
  })

  it('passes audio through and reports when the node cannot be created (never throws)', async () => {
    const onError = vi.fn()
    const insert = createRnnoiseInsert({
      onError,
      getNode: async () => {
        throw new Error('worklet blocked')
      },
    })
    const input = fakeInput()
    await expect(insert.connect(fakeContext(), input)).resolves.toBe(input)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'worklet blocked' }))
  })

  it('reports a processor error once, forgets the broken node and detaches it', async () => {
    const { insert, nodes, onError, forgetNode } = setup()
    const context = fakeContext()
    await insert.connect(context, fakeInput())
    nodes[0]!.fire('processorerror')
    nodes[0]!.fire('processorerror')
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(expect.any(RnnoiseProcessorError))
    expect(forgetNode).toHaveBeenCalledWith(context)
    expect(nodes[0]!.disconnect).toHaveBeenCalled()
    expect(insert.active).toBe(false)
  })

  it('dispose() detaches the node and later connects pass through', async () => {
    const { insert, nodes, getNode } = setup()
    await insert.connect(fakeContext(), fakeInput())
    insert.dispose()
    insert.dispose()
    expect(nodes[0]!.disconnect).toHaveBeenCalled()
    expect(nodes[0]!.removeEventListener).toHaveBeenCalledWith('processorerror', expect.any(Function))
    const input = fakeInput()
    expect(await insert.connect(fakeContext(), input)).toBe(input)
    expect(getNode).toHaveBeenCalledTimes(1)
    expect(insert.active).toBe(false)
  })
})
