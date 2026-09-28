import { describe, expect, it, vi } from 'vitest'
import { createJobQueue } from './queue'
import { chunkRejection, finalizeTarget, isActive, nextAttempt, shouldFinalize, type StaleFacts } from './state'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

describe('createJobQueue', () => {
  it('runs jobs one at a time in FIFO order', async () => {
    const order: string[] = []
    let running = 0
    let maxRunning = 0
    const queue = createJobQueue(async (id) => {
      running++
      maxRunning = Math.max(maxRunning, running)
      order.push(`start:${id}`)
      await new Promise((r) => setTimeout(r, 5))
      order.push(`end:${id}`)
      running--
    })
    for (const id of ['a', 'b', 'c']) expect(queue.enqueue(id)).toBe(true)
    await queue.idle()
    expect(maxRunning).toBe(1)
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c'])
  })

  it('ignores ids that are already queued or running', async () => {
    const gate = deferred()
    const seen: string[] = []
    const queue = createJobQueue(async (id) => {
      seen.push(id)
      await gate.promise
    })
    expect(queue.enqueue('a')).toBe(true)
    expect(queue.enqueue('b')).toBe(true)
    expect(queue.enqueue('b')).toBe(false)
    await vi.waitFor(() => expect(queue.running).toBe('a'))
    expect(queue.enqueue('a')).toBe(false)
    expect(queue.has('a')).toBe(true)
    expect(queue.pending).toEqual(['b'])
    gate.resolve()
    await queue.idle()
    expect(seen).toEqual(['a', 'b'])
    // Once finished, the same id can be queued again (e.g. re-enqueued after a restart marker).
    expect(queue.enqueue('a')).toBe(true)
    await queue.idle()
    expect(seen).toEqual(['a', 'b', 'a'])
  })

  it('drops a queued job on cancel and aborts a running one', async () => {
    const seen: string[] = []
    let aborted = false
    const queue = createJobQueue(async (id, signal) => {
      seen.push(id)
      if (id === 'slow') {
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
        aborted = signal.aborted
      }
    })
    queue.enqueue('slow')
    queue.enqueue('dropped')
    await vi.waitFor(() => expect(queue.running).toBe('slow'))
    await queue.cancel('dropped')
    await queue.cancel('slow')
    expect(aborted).toBe(true)
    expect(queue.running).toBeNull()
    await queue.idle()
    expect(seen).toEqual(['slow'])
  })

  it('reports worker errors and keeps going', async () => {
    const onError = vi.fn()
    const seen: string[] = []
    const queue = createJobQueue(
      async (id) => {
        seen.push(id)
        if (id === 'bad') throw new Error('boom')
      },
      { onError },
    )
    queue.enqueue('bad')
    queue.enqueue('good')
    await queue.idle()
    expect(seen).toEqual(['bad', 'good'])
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'bad')
  })

  it('stops: aborts the running job and accepts nothing afterwards', async () => {
    const seen: string[] = []
    const queue = createJobQueue(async (id, signal) => {
      seen.push(id)
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
    })
    queue.enqueue('a')
    queue.enqueue('b')
    await vi.waitFor(() => expect(queue.running).toBe('a'))
    await queue.stop()
    expect(queue.enqueue('c')).toBe(false)
    await queue.idle()
    expect(seen).toEqual(['a'])
  })
})

describe('recording state rules', () => {
  const startedAt = new Date('2026-09-28T10:00:00Z')
  const at = (ms: number) => new Date(startedAt.getTime() + ms)

  it('treats only recording rows without ended_at as active', () => {
    expect(isActive({ status: 'recording', endedAt: null })).toBe(true)
    expect(isActive({ status: 'recording', endedAt: at(1) })).toBe(false)
    expect(isActive({ status: 'processing', endedAt: null })).toBe(false)
  })

  it('accepts the next chunk and retries, rejects gaps, other states and late chunks', () => {
    const row = { mode: 'server' as const, status: 'recording' as const, chunkCount: 3, startedAt }
    expect(chunkRejection(row, 3, at(1000), 240)).toBeNull()
    expect(chunkRejection(row, 0, at(1000), 240)).toBeNull()
    expect(chunkRejection(row, 4, at(1000), 240)).toBe('gap')
    expect(chunkRejection({ ...row, status: 'processing' }, 3, at(1000), 240)).toBe('not_recording')
    expect(chunkRejection({ ...row, mode: 'local' }, 3, at(1000), 240)).toBe('not_recording')
    expect(chunkRejection(row, 3, at(10 * 60_000 + 2 * 60_000), 10)).toBeNull()
    expect(chunkRejection(row, 3, at(10 * 60_000 + 2 * 60_000 + 1), 10)).toBe('too_late')
  })

  it('retries an interrupted job once, then gives up', () => {
    expect(nextAttempt(null)).toEqual({ attempt: 1, marker: 'attempt:1' })
    expect(nextAttempt('attempt:1')).toEqual({ attempt: 2, marker: 'attempt:2' })
    expect(nextAttempt('attempt:2')).toBe('give_up')
    expect(nextAttempt('something else')).toEqual({ attempt: 1, marker: 'attempt:1' })
  })

  it('finalizes server rows into processing (partial) or failed without chunks, local rows into ready', () => {
    expect(finalizeTarget({ mode: 'server', chunkCount: 5 })).toEqual({ status: 'processing', partial: true, error: null })
    expect(finalizeTarget({ mode: 'server', chunkCount: 0 })).toEqual({ status: 'failed', partial: true, error: 'no_chunks' })
    expect(finalizeTarget({ mode: 'local', chunkCount: 0 })).toEqual({ status: 'ready', partial: false, error: null })
  })

  describe('shouldFinalize', () => {
    const server: StaleFacts = {
      mode: 'server',
      chunkCount: 2,
      startedAt,
      lastChunkAt: at(60_000),
      meetingEnded: false,
      recorderPresent: true,
    }

    it('finalizes server rows after 2 minutes without a chunk', () => {
      expect(shouldFinalize(server, at(60_000 + 119_999), 240)).toBe(false)
      expect(shouldFinalize(server, at(60_000 + 120_000), 240)).toBe(true)
      expect(shouldFinalize({ ...server, lastChunkAt: null }, at(120_000), 240)).toBe(true)
    })

    it('finalizes sooner when the recorder left or the meeting ended, after a 30 s grace', () => {
      expect(shouldFinalize({ ...server, recorderPresent: false }, at(60_000 + 29_999), 240)).toBe(false)
      expect(shouldFinalize({ ...server, recorderPresent: false }, at(60_000 + 30_000), 240)).toBe(true)
      expect(shouldFinalize({ ...server, meetingEnded: true }, at(60_000 + 30_000), 240)).toBe(true)
    })

    it('ends local rows when the recorder is gone, the meeting ended or the maximum duration passed', () => {
      const local: StaleFacts = { ...server, mode: 'local', chunkCount: 0, lastChunkAt: null }
      expect(shouldFinalize(local, at(3 * 3_600_000), 240)).toBe(false)
      expect(shouldFinalize({ ...local, recorderPresent: false }, at(1), 240)).toBe(true)
      expect(shouldFinalize({ ...local, meetingEnded: true }, at(1), 240)).toBe(true)
      expect(shouldFinalize(local, at(240 * 60_000 + 2 * 60_000 + 1), 240)).toBe(true)
    })
  })
})
