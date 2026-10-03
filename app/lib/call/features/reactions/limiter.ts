/**
 * Sliding-window rate limiter per key (pure). Reactions use it for the own send rate (3 per second) and per sender on
 * receive; chat uses it per sender (20 messages per 10 s). A well-behaved client never hits the receive limits; they
 * keep one noisy or modified client from flooding everyone else's screen.
 */
export interface LimiterOptions {
  /** Events allowed per window. */
  limit: number
  windowMs: number
  /** Keys remembered at most (oldest dropped), so a stream of fake identities cannot grow memory. */
  maxKeys?: number
}

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>()
  private readonly maxKeys: number

  constructor(private readonly options: LimiterOptions) {
    this.maxKeys = options.maxKeys ?? 200
  }

  /** Records an event for `key` at `now` and returns whether it is within the limit. */
  allow(key: string, now: number): boolean {
    const since = now - this.options.windowMs
    const recent = (this.hits.get(key) ?? []).filter((at) => at > since)
    if (recent.length >= this.options.limit) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(now)
    this.hits.delete(key)
    this.hits.set(key, recent)
    if (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next().value
      if (oldest !== undefined) this.hits.delete(oldest)
    }
    return true
  }

  /** Remaining events for `key` right now. */
  remaining(key: string, now: number): number {
    const since = now - this.options.windowMs
    const recent = (this.hits.get(key) ?? []).filter((at) => at > since)
    return Math.max(0, this.options.limit - recent.length)
  }

  reset(): void {
    this.hits.clear()
  }
}

/** Own reactions: at most 3 per second. */
export const SEND_LIMIT = { limit: 3, windowMs: 1_000 } as const
/** Incoming reactions per sender (decision): 6 per 2 s, a little above what a well-behaved client sends. */
export const RECEIVE_LIMIT = { limit: 6, windowMs: 2_000 } as const
