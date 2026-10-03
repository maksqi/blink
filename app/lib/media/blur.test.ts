import { describe, expect, it, vi } from 'vitest'
import { BlurEngine, blurSwitchOptions, type BlurProcessor, type BlurSwitchOptions } from './blur'

function fakeProcessor() {
  const switches: BlurSwitchOptions[] = []
  const processor = {
    name: 'fake-background',
    processedTrack: undefined as MediaStreamTrack | undefined,
    switches,
    init: vi.fn(async () => undefined),
    restart: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
    switchTo: vi.fn(async (options: BlurSwitchOptions) => {
      switches.push(options)
    }),
  }
  return processor
}

function setup(options: { attachFails?: boolean; createFails?: boolean } = {}) {
  const processors: Array<ReturnType<typeof fakeProcessor>> = []
  const calls: Array<'attach' | 'detach'> = []
  const setCameraProcessor = vi.fn(async (processor: unknown) => {
    calls.push(processor ? 'attach' : 'detach')
    if (processor && options.attachFails) throw new Error('init failed')
  })
  const createProcessor = vi.fn(async () => {
    if (options.createFails) throw new Error('import failed')
    const processor = fakeProcessor()
    processors.push(processor)
    return processor as unknown as BlurProcessor
  })
  const engine = new BlurEngine({ setCameraProcessor, createProcessor })
  return { engine, processors, calls, setCameraProcessor, createProcessor }
}

describe('blurSwitchOptions', () => {
  it('maps levels to the processor modes (light 6, strong 14)', () => {
    expect(blurSwitchOptions('off')).toEqual({ mode: 'disabled' })
    expect(blurSwitchOptions('light')).toEqual({ mode: 'background-blur', blurRadius: 6 })
    expect(blurSwitchOptions('strong')).toEqual({ mode: 'background-blur', blurRadius: 14 })
  })
})

describe('BlurEngine', () => {
  it('does nothing until the first non-off level', async () => {
    const { engine, createProcessor, setCameraProcessor } = setup()
    await engine.apply('off')
    expect(createProcessor).not.toHaveBeenCalled()
    expect(setCameraProcessor).not.toHaveBeenCalled()
    expect(engine.attached).toBe(false)
  })

  it('creates and attaches the processor once, with the mode set before attaching', async () => {
    const { engine, processors, calls } = setup()
    await engine.apply('strong')
    expect(processors).toHaveLength(1)
    expect(processors[0]!.switches).toEqual([{ mode: 'background-blur', blurRadius: 14 }])
    expect(calls).toEqual(['attach'])
    expect(engine.attached).toBe(true)
    expect(engine.level).toBe('strong')
  })

  it('afterwards only switches modes: never detaches, stops or re-creates the processor', async () => {
    const { engine, processors, calls } = setup()
    await engine.apply('light')
    await engine.apply('off')
    await engine.apply('strong')
    await engine.apply('off')
    await engine.apply('light')
    expect(processors).toHaveLength(1)
    expect(calls).toEqual(['attach'])
    expect(processors[0]!.destroy).not.toHaveBeenCalled()
    expect(processors[0]!.switches).toEqual([
      { mode: 'background-blur', blurRadius: 6 },
      { mode: 'disabled' },
      { mode: 'background-blur', blurRadius: 14 },
      { mode: 'disabled' },
      { mode: 'background-blur', blurRadius: 6 },
    ])
  })

  it('serializes overlapping calls in order', async () => {
    const { engine, processors } = setup()
    await Promise.all([engine.apply('light'), engine.apply('off'), engine.apply('strong')])
    expect(processors).toHaveLength(1)
    expect(processors[0]!.switches.map((s) => s.mode)).toEqual(['background-blur', 'disabled', 'background-blur'])
    expect(engine.level).toBe('strong')
  })

  it('removes the processor again and rejects when init fails, and retries with a new one later', async () => {
    const { engine, processors, calls } = setup({ attachFails: true })
    await expect(engine.apply('strong')).rejects.toThrow('init failed')
    expect(calls).toEqual(['attach', 'detach'])
    expect(processors[0]!.destroy).toHaveBeenCalled()
    expect(engine.attached).toBe(false)
    expect(engine.level).toBe('off')
    await expect(engine.apply('light')).rejects.toThrow('init failed')
    expect(processors).toHaveLength(2)
  })

  it('rejects without touching the camera when the library cannot load', async () => {
    const { engine, setCameraProcessor } = setup({ createFails: true })
    await expect(engine.apply('light')).rejects.toThrow('import failed')
    expect(setCameraProcessor).not.toHaveBeenCalled()
    expect(engine.level).toBe('off')
  })

  it('reset() clears a processor that never ran', async () => {
    const { engine, processors, calls } = setup()
    await engine.apply('light')
    await engine.reset()
    expect(calls).toEqual(['attach', 'detach'])
    expect(processors[0]!.destroy).toHaveBeenCalled()
    expect(engine.attached).toBe(false)
  })

  it('destroy() stops the processor and ignores later calls', async () => {
    const { engine, processors, calls } = setup()
    await engine.apply('light')
    engine.destroy()
    await engine.apply('strong')
    await Promise.resolve()
    expect(processors[0]!.destroy).toHaveBeenCalledTimes(1)
    expect(processors[0]!.switches).toHaveLength(1)
    expect(calls).toEqual(['attach'])
  })

  it('reports processed frames', async () => {
    const onFrameProcessed = vi.fn()
    let report: ((stats: { processingTimeMs: number }) => void) | undefined
    const engine = new BlurEngine({
      setCameraProcessor: async () => undefined,
      onFrameProcessed,
      createProcessor: async (onFrame) => {
        report = onFrame
        return fakeProcessor() as unknown as BlurProcessor
      },
    })
    await engine.apply('light')
    report?.({ processingTimeMs: 12 })
    expect(onFrameProcessed).toHaveBeenCalledWith({ processingTimeMs: 12 })
  })
})
