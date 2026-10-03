import { describe, expect, it } from 'vitest'
import { ROOM_ERRORS } from '#shared/utils/error-codes'
import {
  isInlineJoinProblem,
  isJoinApiCode,
  JOIN_API_CODES,
  joinErrorCopy,
  toJoinProblem,
  type JoinProblemCode,
} from './errors'

const CLIENT: JoinProblemCode[] = ['MISSING_KEY', 'INVALID_LINK', 'UNSUPPORTED_BROWSER', 'MEETING_ENDED', 'UNKNOWN']

describe('join error copy', () => {
  it('has a title, a message and a next step for every join code and client problem', () => {
    for (const code of [...JOIN_API_CODES, ...CLIENT]) {
      const copy = joinErrorCopy({ code })
      expect(copy.title.length, code).toBeGreaterThan(3)
      expect(copy.message.length, code).toBeGreaterThan(10)
      expect(['home', 'retry', 'signin']).toContain(copy.next)
      // Sentence case, no exclamation marks (AGENT.md UI copy).
      expect(copy.title + copy.message, code).not.toMatch(/!/)
    }
  })

  it('covers every room join error code the server documents', () => {
    const joinCodes = Object.keys(ROOM_ERRORS).filter(
      (code) => !['MEETING_LIVE', 'CALL_NOT_PARTICIPANT', 'CALL_FORBIDDEN', 'ROOM_LIMIT_REACHED'].includes(code),
    )
    for (const code of joinCodes) expect(isJoinApiCode(code), code).toBe(true)
  })

  it('sends guests of account-only rooms to sign in, and final answers home', () => {
    expect(joinErrorCopy({ code: 'ROOM_GUESTS_NOT_ALLOWED' }).next).toBe('signin')
    for (const code of ['ROOM_KEY_INVALID', 'ROOM_NOT_FOUND', 'JOIN_REMOVED', 'JOIN_DENIED', 'INVALID_LINK'] as const) {
      expect(joinErrorCopy({ code }).next).toBe('home')
    }
    for (const code of ['ROOM_LOCKED', 'ROOM_FULL', 'LOBBY_FULL', 'RATE_LIMITED', 'UNKNOWN'] as const) {
      expect(joinErrorCopy({ code }).next).toBe('retry')
    }
  })

  // F-044: 503 when the server cannot reach LiveKit is a known, temporary problem, not "something went wrong".
  it('explains an unreachable media service and offers a retry', () => {
    const copy = joinErrorCopy(toJoinProblem('SERVICE_UNAVAILABLE'))
    expect(copy).toEqual(expect.objectContaining({ title: "The meeting service isn't available", next: 'retry' }))
    expect(copy).not.toEqual(joinErrorCopy({ code: 'UNKNOWN' }))
    expect(isInlineJoinProblem('SERVICE_UNAVAILABLE')).toBe(true)
  })

  it('says how long a rate limit lasts', () => {
    expect(joinErrorCopy({ code: 'RATE_LIMITED', retryAfter: 1 }).message).toContain('1 second.')
    expect(joinErrorCopy({ code: 'RATE_LIMITED', retryAfter: 42 }).message).toContain('42 seconds')
    expect(joinErrorCopy({ code: 'RATE_LIMITED', retryAfter: 61 }).message).toContain('2 minutes')
    expect(joinErrorCopy({ code: 'RATE_LIMITED' }).message).toBe('Wait a moment, then try again.')
  })
})

describe('toJoinProblem', () => {
  it('keeps join codes and maps everything else to UNKNOWN', () => {
    expect(toJoinProblem('ROOM_FULL')).toEqual({ code: 'ROOM_FULL' })
    expect(toJoinProblem('SERVICE_UNAVAILABLE')).toEqual({ code: 'SERVICE_UNAVAILABLE' })
    expect(toJoinProblem('NETWORK')).toEqual({ code: 'UNKNOWN' })
    expect(toJoinProblem('CSRF_REJECTED')).toEqual({ code: 'UNKNOWN' })
    expect(toJoinProblem(undefined)).toEqual({ code: 'UNKNOWN' })
  })

  it('keeps a sane rate-limit wait only', () => {
    expect(toJoinProblem('RATE_LIMITED', '7')).toEqual({ code: 'RATE_LIMITED', retryAfter: 7 })
    expect(toJoinProblem('RATE_LIMITED', 0.2)).toEqual({ code: 'RATE_LIMITED', retryAfter: 1 })
    expect(toJoinProblem('RATE_LIMITED', -3)).toEqual({ code: 'RATE_LIMITED' })
    expect(toJoinProblem('RATE_LIMITED', 'soon')).toEqual({ code: 'RATE_LIMITED' })
    expect(toJoinProblem('ROOM_FULL', 9)).toEqual({ code: 'ROOM_FULL' })
  })
})

describe('inline problems', () => {
  it('keeps retryable problems on the join screens', () => {
    for (const code of ['ROOM_LOCKED', 'ROOM_FULL', 'LOBBY_FULL', 'RATE_LIMITED', 'ROOM_PASSWORD_INVALID'] as const) {
      expect(isInlineJoinProblem(code), code).toBe(true)
    }
    for (const code of ['ROOM_KEY_INVALID', 'ROOM_INVITE_INVALID', 'JOIN_DENIED', 'MEETING_ENDED'] as const) {
      expect(isInlineJoinProblem(code), code).toBe(false)
    }
  })
})
