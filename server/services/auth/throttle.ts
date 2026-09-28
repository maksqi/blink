/**
 * Login backoff (auth, docs/API.md §1.2 limiter `login`) over the `login_throttle` table.
 *
 * Keys per attempt: `email:<address>` and `ip:<v4>` or `net:<v6 /64>` (`loginThrottleKeys`). 5 free failures per key,
 * then `2^(n-5)` s, capped at 900 s; failures older than 24 h no longer count; never a hard lockout (decision on the
 * numbers, server-core `backoffDelayMs`). Unknown emails count exactly like known ones, so 429s reveal nothing.
 * A successful sign-in clears the email key only: an attacker's IP stays slowed down.
 *
 * - `createLoginThrottle(store)`: the policy over any `ThrottleStore`; `memoryThrottleStore()` for unit tests.
 * - `loginThrottle`: the shared instance over the database store (server-core's `checkLoginAllowed`,
 *   `recordLoginFailure`, `clearLoginFailures`).
 */
import type { H3Event } from 'h3'
import {
  backoffDelayMs,
  checkLoginAllowed,
  clearLoginFailures,
  emailThrottleKey,
  loginThrottleKeys,
  nextFailureCount,
  recordLoginFailure,
  throttleDecision,
  throwRateLimited,
  type ThrottleDecision,
} from '../../utils/limiter'

export { backoffDelayMs, emailThrottleKey, loginThrottleKeys }

export interface ThrottleStore {
  check(keys: string[], now: Date): Promise<ThrottleDecision>
  recordFailure(keys: string[], now: Date): Promise<void>
  clear(keys: string[]): Promise<void>
}

export interface LoginThrottle {
  /** `{ allowed, retryAfterMs }` for an attempt with these keys. */
  check(keys: string[], now?: Date): Promise<ThrottleDecision>
  /** Throws 429 `RATE_LIMITED` with `Retry-After` while any key is backing off. */
  assertAllowed(event: H3Event, keys: string[], now?: Date): Promise<void>
  recordFailure(keys: string[], now?: Date): Promise<void>
  /** After a successful sign-in: forget the failures of this email (not of the IP). */
  recordSuccess(email: string): Promise<void>
  clear(keys: string[]): Promise<void>
}

export function createLoginThrottle(store: ThrottleStore): LoginThrottle {
  return {
    check: (keys, now = new Date()) => store.check(keys, now),
    async assertAllowed(event, keys, now = new Date()) {
      const decision = await store.check(keys, now)
      if (!decision.allowed) throwRateLimited(event, decision.retryAfterMs)
    },
    recordFailure: (keys, now = new Date()) => store.recordFailure(keys, now),
    recordSuccess: (email) => store.clear([emailThrottleKey(email)]),
    clear: (keys) => store.clear(keys),
  }
}

export const databaseThrottleStore: ThrottleStore = {
  check: (keys, now) => checkLoginAllowed(keys, now),
  recordFailure: (keys, now) => recordLoginFailure(keys, now),
  clear: (keys) => clearLoginFailures(keys),
}

/** Same rules as the database store, in memory. */
export function memoryThrottleStore(): ThrottleStore & {
  rows: Map<string, { failures: number; updatedAt: Date; nextAllowedAt: Date | null }>
} {
  const rows = new Map<string, { failures: number; updatedAt: Date; nextAllowedAt: Date | null }>()
  return {
    rows,
    async check(keys, now) {
      return throttleDecision(
        [...new Set(keys)].map((key) => ({ nextAllowedAt: rows.get(key)?.nextAllowedAt ?? null })),
        now,
      )
    },
    async recordFailure(keys, now) {
      for (const key of new Set(keys)) {
        const row = rows.get(key)
        const failures = nextFailureCount(row, now)
        const delay = backoffDelayMs(failures)
        // Like the SQL upsert: a new wait never shortens a longer one that is already running.
        const nextAllowedAt =
          delay > 0
            ? new Date(Math.max(now.getTime() + delay, row?.nextAllowedAt?.getTime() ?? 0))
            : (row?.nextAllowedAt ?? null)
        rows.set(key, { failures, updatedAt: now, nextAllowedAt })
      }
    },
    async clear(keys) {
      for (const key of keys) rows.delete(key)
    },
  }
}

export const loginThrottle = createLoginThrottle(databaseThrottleStore)
