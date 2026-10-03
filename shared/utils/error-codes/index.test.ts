import { describe, expect, it } from 'vitest'
import { ERROR_MESSAGES, errorMessage, type ErrorCode } from './index'

/** Final answers and plain rules: there is nothing to do, so the message only says what happened or who may act. */
const FINAL: ErrorCode[] = [
  'FORBIDDEN',
  'JOIN_REMOVED',
  'JOIN_DENIED',
  'CALL_NOT_PARTICIPANT',
  'CALL_FORBIDDEN',
  'RECORDING_ACTIVE',
  'RECORDING_NOT_ALLOWED',
]

describe('ERROR_MESSAGES copy', () => {
  it('is short English in sentence case without exclamation marks (AGENT.md UI copy)', () => {
    for (const [code, message] of Object.entries(ERROR_MESSAGES)) {
      expect(message, code).toMatch(/^[A-Z][^!]*\.$/)
      expect(message.length, code).toBeLessThanOrEqual(110)
    }
  })

  // F-045: errors say what happened and what to do.
  it('gives a next step after saying what happened', () => {
    const withoutNextStep = (Object.keys(ERROR_MESSAGES) as ErrorCode[]).filter((code) => {
      if (FINAL.includes(code)) return false
      const sentences = ERROR_MESSAGES[code].split(/(?<=\.)\s+/)
      const instruction =
        /\b(try|ask|check|reload|refresh|sign in|contact|enter|choose|change|end|delete|use|open|request|start|wait)\b/i
      return sentences.length < 2 && !instruction.test(ERROR_MESSAGES[code])
    })
    expect(withoutNextStep).toEqual([])
  })

  it('falls back to the generic message for unknown codes', () => {
    expect(errorMessage('NOPE')).toBe(ERROR_MESSAGES.INTERNAL)
    expect(errorMessage(undefined)).toBe(ERROR_MESSAGES.INTERNAL)
    expect(errorMessage('ROOM_FULL')).toBe(ERROR_MESSAGES.ROOM_FULL)
  })
})
