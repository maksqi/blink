import { describe, expect, it, vi } from 'vitest'
import { lazyCallComponent, preloadCallComponents } from './lazy'

const Stub = { name: 'Stub', render: () => null }

describe('lazy call components (F-043)', () => {
  it('load nothing until rendered or preloaded, and the preload never rejects', async () => {
    const ok = vi.fn(async () => ({ default: Stub }))
    const failing = vi.fn(async () => {
      throw new Error('chunk failed')
    })
    const component = lazyCallComponent(ok)
    lazyCallComponent(failing)
    expect(ok).not.toHaveBeenCalled()
    expect((component as { __asyncLoader?: unknown }).__asyncLoader).toBeTypeOf('function')
    await expect(preloadCallComponents()).resolves.toBeUndefined()
    expect(ok).toHaveBeenCalledTimes(1)
    expect(failing).toHaveBeenCalledTimes(1)
  })
})
