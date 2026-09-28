/**
 * Counting semaphore (server-core): at most `max` tasks run at once, the rest wait in FIFO order.
 * Used to cap concurrent argon2 work (docs/SECURITY.md §4); reusable for other CPU-heavy jobs.
 *
 *   const cpu = createSemaphore(4)
 *   await cpu.run(() => expensive())
 */
export interface Semaphore {
  run<T>(task: () => Promise<T>): Promise<T>
  readonly active: number
  readonly waiting: number
}

export function createSemaphore(max: number): Semaphore {
  if (!Number.isInteger(max) || max < 1) throw new RangeError('Semaphore size must be a positive integer')
  let active = 0
  const queue: Array<() => void> = []

  const release = () => {
    const next = queue.shift()
    if (next) next()
    else active--
  }

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (active < max) active++
      else await new Promise<void>((resolve) => queue.push(resolve))
      try {
        return await task()
      } finally {
        release()
      }
    },
    get active() {
      return active
    },
    get waiting() {
      return queue.length
    },
  }
}
