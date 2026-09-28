/**
 * Rate limiting and brute-force backoff (server-core, docs/API.md §1.2, docs/SECURITY.md §4).
 *
 * In-memory sliding-window limiters (single node; swap the store for multi-node later):
 * - `createLimiter({ name, limit, windowMs })` → `limiter.consume(key)` → `{ allowed, remaining, retryAfterMs }`.
 * - `getLimiter(name)`: the shared instance of a documented limiter (`RATE_LIMITS`: auth-ip, reset-email, join-ip,
 *   room-create, call-actions, recording-chunks). Use it instead of creating duplicates.
 * - `consumeOr429(event, limiterOrName, key)`: throws 429 `RATE_LIMITED` with `Retry-After` (seconds).
 * - `throwRateLimited(event, retryAfterMs)`: the same error for custom checks (e.g. the login backoff).
 *
 * Keys: per-IP limits use `limiterKeysForIp(getClientIp(event)).net` (IPv6 /64); users `userLimiterKey(id)`;
 * participants `participant:<rowId>`; recordings `recording:<id>`; emails `emailThrottleKey(email)`.
 *
 * Exponential backoff in table `login_throttle` (never a hard lockout):
 * - `backoffDelayMs(failures)`: 5 free failures, then `2^(n-5)` s, capped at 900 s.
 * - `checkLoginAllowed(keys)`, `recordLoginFailure(keys)`, `clearLoginFailures(keys)`. Keys come from
 *   `loginThrottleKeys(email, ip)` (`email:<address>` plus `ip:<v4>` or `net:<v6 /64>`); a successful login
 *   clears only the email key. Room passwords use `roomPasswordThrottleKey(roomId, ip)` with the same functions.
 * - Failures older than 24 h no longer count (decision); `maintenance:cleanup` deletes those rows.
 */
import { eq, inArray, sql } from 'drizzle-orm'
import { setResponseHeader, type H3Event } from 'h3'
import { useDb } from '../database/client'
import { loginThrottle } from '../database/schema'
import { apiError } from './api-error'
import { limiterKeysForIp } from './client-ip'

// ---- In-memory sliding window ---------------------------------------------------------------------------------------

export interface LimiterOptions {
  name: string
  limit: number
  windowMs: number
  /** Injectable clock (ms), for tests. */
  now?: () => number
  /** Soft cap on tracked keys; the oldest keys are dropped beyond it. */
  maxKeys?: number
}

export interface LimitResult {
  allowed: boolean
  remaining: number
  retryAfterMs: number
}

export interface Limiter {
  readonly name: string
  readonly limit: number
  readonly windowMs: number
  consume(key: string): LimitResult
  peek(key: string): LimitResult
  reset(key?: string): void
  readonly size: number
}

export function createLimiter(options: LimiterOptions): Limiter {
  const { name, limit, windowMs, now = Date.now, maxKeys = 50_000 } = options
  if (!Number.isInteger(limit) || limit < 1 || !(windowMs > 0)) throw new RangeError(`Invalid limiter ${name}`)
  const hits = new Map<string, number[]>()
  let lastSweep = now()

  const live = (key: string, at: number) => {
    const list = hits.get(key)
    if (!list) return undefined
    while (list.length && list[0]! <= at - windowMs) list.shift()
    if (!list.length) hits.delete(key)
    return list.length ? list : undefined
  }

  const sweep = (at: number) => {
    lastSweep = at
    for (const key of [...hits.keys()]) live(key, at)
    for (const key of hits.keys()) {
      if (hits.size <= maxKeys) break
      hits.delete(key)
    }
  }

  const result = (list: number[] | undefined, at: number): LimitResult => {
    const count = list?.length ?? 0
    if (count < limit) return { allowed: true, remaining: limit - count, retryAfterMs: 0 }
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(1, list![0]! + windowMs - at) }
  }

  return {
    name,
    limit,
    windowMs,
    consume(key) {
      const at = now()
      if (at - lastSweep > windowMs || hits.size > maxKeys) sweep(at)
      const list = live(key, at)
      const before = result(list, at)
      if (!before.allowed) return before
      if (list) list.push(at)
      else hits.set(key, [at])
      return { allowed: true, remaining: before.remaining - 1, retryAfterMs: 0 }
    },
    peek(key) {
      const at = now()
      return result(live(key, at), at)
    },
    reset(key) {
      if (key === undefined) hits.clear()
      else hits.delete(key)
    },
    get size() {
      return hits.size
    },
  }
}

/** Documented limits (docs/API.md §1.2). */
export const RATE_LIMITS = {
  'auth-ip': { limit: 10, windowMs: 60_000 },
  'reset-email': { limit: 3, windowMs: 3_600_000 },
  'join-ip': { limit: 30, windowMs: 60_000 },
  'room-create': { limit: 20, windowMs: 3_600_000 },
  'call-actions': { limit: 120, windowMs: 60_000 },
  'recording-chunks': { limit: 8, windowMs: 1_000 },
} as const satisfies Record<string, { limit: number; windowMs: number }>

export type LimiterName = keyof typeof RATE_LIMITS

const sharedLimiters = new Map<LimiterName, Limiter>()

export function getLimiter(name: LimiterName): Limiter {
  let limiter = sharedLimiters.get(name)
  if (!limiter) {
    limiter = createLimiter({ name, ...RATE_LIMITS[name] })
    sharedLimiters.set(name, limiter)
  }
  return limiter
}

export function retryAfterSeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000))
}

export function throwRateLimited(event: H3Event, retryAfterMs: number): never {
  const seconds = retryAfterSeconds(retryAfterMs)
  setResponseHeader(event, 'Retry-After', seconds)
  throw apiError('RATE_LIMITED', 429, { retryAfter: seconds })
}

export function consumeOr429(event: H3Event, limiter: Limiter | LimiterName, key: string): void {
  const instance = typeof limiter === 'string' ? getLimiter(limiter) : limiter
  const outcome = instance.consume(key)
  if (!outcome.allowed) throwRateLimited(event, outcome.retryAfterMs)
}

export function userLimiterKey(userId: string): string {
  return `user:${userId}`
}

// ---- Exponential backoff (login, room passwords) --------------------------------------------------------------------

export const BACKOFF_FREE_FAILURES = 5
export const BACKOFF_MAX_MS = 900_000
export const LOGIN_FAILURE_WINDOW_MS = 24 * 3_600_000

/** Wait required after `failures` consecutive failures: 0 for the first 5, then 2^(n-5) s, at most 900 s. */
export function backoffDelayMs(failures: number): number {
  if (failures <= BACKOFF_FREE_FAILURES) return 0
  return Math.min(BACKOFF_MAX_MS, 2 ** (failures - BACKOFF_FREE_FAILURES) * 1000)
}

export interface ThrottleDecision {
  allowed: boolean
  retryAfterMs: number
}

/** Pure decision over the stored rows of all keys of an attempt. */
export function throttleDecision(rows: Array<{ nextAllowedAt: Date | null }>, now: Date): ThrottleDecision {
  let wait = 0
  for (const row of rows) {
    if (row.nextAllowedAt) wait = Math.max(wait, row.nextAllowedAt.getTime() - now.getTime())
  }
  return wait > 0 ? { allowed: false, retryAfterMs: wait } : { allowed: true, retryAfterMs: 0 }
}

/** Pure: the failure count after one more failure (older failures expire after 24 h). */
export function nextFailureCount(row: { failures: number; updatedAt: Date } | undefined, now: Date): number {
  if (!row || now.getTime() - row.updatedAt.getTime() > LOGIN_FAILURE_WINDOW_MS) return 1
  return row.failures + 1
}

export function emailThrottleKey(email: string): string {
  return `email:${email.trim().toLowerCase()}`
}

export function loginThrottleKeys(email: string, ip: string | null): string[] {
  return [emailThrottleKey(email), limiterKeysForIp(ip).net]
}

export function roomPasswordThrottleKey(roomId: string, ip: string | null): string {
  return `room:${roomId}:${limiterKeysForIp(ip).net}`
}

export async function checkLoginAllowed(keys: string[], now: Date = new Date()): Promise<ThrottleDecision> {
  const unique = [...new Set(keys)]
  if (!unique.length) return { allowed: true, retryAfterMs: 0 }
  const rows = await useDb()
    .select({ nextAllowedAt: loginThrottle.nextAllowedAt })
    .from(loginThrottle)
    .where(inArray(loginThrottle.key, unique))
  return throttleDecision(rows, now)
}

export async function recordLoginFailure(keys: string[], now: Date = new Date()): Promise<void> {
  const db = useDb()
  const staleBefore = new Date(now.getTime() - LOGIN_FAILURE_WINDOW_MS)
  for (const key of new Set(keys)) {
    // One atomic upsert per key, so parallel failures never lose a count.
    const [row] = await db
      .insert(loginThrottle)
      .values({ key, failures: 1, nextAllowedAt: null, updatedAt: now })
      .onConflictDoUpdate({
        target: loginThrottle.key,
        set: {
          failures: sql`case when ${loginThrottle.updatedAt} < ${staleBefore} then 1 else ${loginThrottle.failures} + 1 end`,
          updatedAt: now,
        },
      })
      .returning({ failures: loginThrottle.failures })
    const delay = backoffDelayMs(row?.failures ?? 1)
    if (delay > 0) {
      const next = new Date(now.getTime() + delay)
      await db
        .update(loginThrottle)
        .set({ nextAllowedAt: sql`greatest(coalesce(${loginThrottle.nextAllowedAt}, ${next}), ${next})`, updatedAt: now })
        .where(eq(loginThrottle.key, key))
    }
  }
}

export async function clearLoginFailures(keys: string[]): Promise<void> {
  const unique = [...new Set(keys)]
  if (unique.length) await useDb().delete(loginThrottle).where(inArray(loginThrottle.key, unique))
}
