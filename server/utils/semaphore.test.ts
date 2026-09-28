import { describe, expect, it } from 'vitest'
import { createSemaphore } from './semaphore'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

describe('createSemaphore', () => {
  it('runs at most max tasks at once and releases in FIFO order', async () => {
    const semaphore = createSemaphore(2)
    const gates = [deferred(), deferred(), deferred(), deferred()]
    const started: number[] = []
    const runs = gates.map((gate, i) =>
      semaphore.run(async () => {
        started.push(i)
        await gate.promise
        return i
      }),
    )
    await Promise.resolve()
    expect(started).toEqual([0, 1])
    expect(semaphore.active).toBe(2)
    expect(semaphore.waiting).toBe(2)

    gates[1]!.resolve()
    await runs[1]
    await Promise.resolve()
    expect(started).toEqual([0, 1, 2])

    gates[0]!.resolve()
    gates[2]!.resolve()
    gates[3]!.resolve()
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3])
    expect(semaphore.active).toBe(0)
    expect(semaphore.waiting).toBe(0)
  })

  it('releases the slot when a task fails', async () => {
    const semaphore = createSemaphore(1)
    await expect(semaphore.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(await semaphore.run(() => Promise.resolve('ok'))).toBe('ok')
    expect(semaphore.active).toBe(0)
  })

  it('rejects invalid sizes', () => {
    expect(() => createSemaphore(0)).toThrow(RangeError)
    expect(() => createSemaphore(1.5)).toThrow(RangeError)
  })
})
