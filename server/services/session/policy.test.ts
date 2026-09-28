import { describe, expect, it } from 'vitest'
import {
  isSessionActive,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TTL_MS,
  sessionExpiresAt,
  sessionInvalidReason,
  shouldTouch,
} from './policy'

const DAY = 24 * 3_600_000
const created = new Date('2026-03-01T12:00:00.000Z')
const at = (ms: number) => new Date(created.getTime() + ms)

describe('session policy (injected clock)', () => {
  it('expires 30 days after creation, even when used every day', () => {
    expect(SESSION_ABSOLUTE_TTL_MS).toBe(30 * DAY)
    const session = { expiresAt: sessionExpiresAt(created), lastSeenAt: at(30 * DAY - 60_000) }
    expect(sessionInvalidReason(session, { disabledAt: null }, at(30 * DAY - 1))).toBeNull()
    expect(sessionInvalidReason(session, { disabledAt: null }, at(30 * DAY))).toBe('expired')
  })

  it('expires after 7 idle days', () => {
    expect(SESSION_IDLE_TTL_MS).toBe(7 * DAY)
    const session = { expiresAt: sessionExpiresAt(created), lastSeenAt: at(2 * DAY) }
    expect(sessionInvalidReason(session, { disabledAt: null }, at(9 * DAY - 1))).toBeNull()
    expect(sessionInvalidReason(session, { disabledAt: null }, at(9 * DAY))).toBe('idle')
    expect(isSessionActive(session, at(9 * DAY))).toBe(false)
    expect(isSessionActive(session, at(8 * DAY))).toBe(true)
  })

  it('rejects sessions of disabled users', () => {
    const session = { expiresAt: sessionExpiresAt(created), lastSeenAt: created }
    expect(sessionInvalidReason(session, { disabledAt: at(1) }, at(2))).toBe('disabled')
  })

  it('touches last_seen_at at most once a minute', () => {
    expect(shouldTouch(created, at(59_999))).toBe(false)
    expect(shouldTouch(created, at(60_000))).toBe(true)
    expect(shouldTouch(created, created)).toBe(false)
  })
})
