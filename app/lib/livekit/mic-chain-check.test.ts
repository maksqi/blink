import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MIC_CHAIN_START_TIMEOUT_MS, waitUntilRunning } from './mic-chain-check'

class FakeContext extends EventTarget {
  constructor(public state: AudioContextState) {
    super()
  }
  set(state: AudioContextState) {
    this.state = state
    this.dispatchEvent(new Event('statechange'))
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('waitUntilRunning (F-060)', () => {
  it('is true at once for a running context and false for a closed one', async () => {
    await expect(waitUntilRunning(new FakeContext('running'))).resolves.toBe(true)
    await expect(waitUntilRunning(new FakeContext('closed'))).resolves.toBe(false)
  })

  it('is true when the context starts running within the timeout', async () => {
    const context = new FakeContext('suspended')
    const result = waitUntilRunning(context)
    await vi.advanceTimersByTimeAsync(800)
    context.set('running')
    await expect(result).resolves.toBe(true)
  })

  it('is false when the context still does not run after the timeout (the raw microphone is sent)', async () => {
    const context = new FakeContext('suspended')
    let result: boolean | undefined
    void waitUntilRunning(context).then((value) => (result = value))
    await vi.advanceTimersByTimeAsync(MIC_CHAIN_START_TIMEOUT_MS - 1)
    expect(result).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(result).toBe(false)
  })

  it('is false when the context closes while waiting', async () => {
    const context = new FakeContext('suspended')
    const result = waitUntilRunning(context)
    context.set('closed')
    await expect(result).resolves.toBe(false)
  })
})
