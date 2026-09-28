/**
 * In-memory FIFO job queue with concurrency 1 (transcoding is CPU-heavy; one job at a time). The database is the
 * source of truth: the queue only holds ids, a restart loses it, and `recordings:finalize-stale` (plus a scan at boot)
 * re-enqueues every `processing` row. Duplicate ids are ignored while queued or running.
 *
 * - `enqueue(id)` → false when already queued, running or the queue is stopped.
 * - `cancel(id)`: drops a queued id or aborts the running job and waits until it has settled.
 * - `stop()`: drops everything and aborts the running job (shutdown).
 * - `idle()`: resolves once nothing is queued or running (tests).
 */
export type JobWorker = (id: string, signal: AbortSignal) => Promise<void>

export interface JobQueue {
  enqueue(id: string): boolean
  cancel(id: string): Promise<void>
  has(id: string): boolean
  readonly running: string | null
  readonly pending: readonly string[]
  idle(): Promise<void>
  stop(): Promise<void>
}

export interface JobQueueOptions {
  onError?: (error: unknown, id: string) => void
}

export function createJobQueue(worker: JobWorker, options: JobQueueOptions = {}): JobQueue {
  const pending: string[] = []
  let current: { id: string; controller: AbortController; done: Promise<void> } | null = null
  let stopped = false
  let idleWaiters: Array<() => void> = []

  const settleIdle = () => {
    if (current || pending.length) return
    const waiters = idleWaiters
    idleWaiters = []
    for (const resolve of waiters) resolve()
  }

  const pump = () => {
    if (current || stopped) return settleIdle()
    const id = pending.shift()
    if (id === undefined) return settleIdle()
    const controller = new AbortController()
    const done = (async () => {
      try {
        await worker(id, controller.signal)
      } catch (error) {
        options.onError?.(error, id)
      }
    })()
    current = { id, controller, done }
    void done.then(() => {
      current = null
      // Next job on a fresh tick, so a long queue never grows the stack.
      setImmediate(pump)
    })
  }

  return {
    enqueue(id) {
      if (stopped || current?.id === id || pending.includes(id)) return false
      pending.push(id)
      if (!current) setImmediate(pump)
      return true
    },
    async cancel(id) {
      const index = pending.indexOf(id)
      if (index >= 0) pending.splice(index, 1)
      if (current?.id === id) {
        const running = current
        running.controller.abort()
        await running.done
      }
      settleIdle()
    },
    has(id) {
      return current?.id === id || pending.includes(id)
    },
    get running() {
      return current?.id ?? null
    },
    get pending() {
      return [...pending]
    },
    idle() {
      if (!current && !pending.length) return Promise.resolve()
      return new Promise<void>((resolve) => idleWaiters.push(resolve))
    },
    async stop() {
      stopped = true
      pending.length = 0
      if (current) {
        const running = current
        running.controller.abort()
        await running.done
      }
      settleIdle()
    },
  }
}
