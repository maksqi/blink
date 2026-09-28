import { describe, expect, it } from 'vitest'
import { pickResumable, RESUME_GRACE_MS, resumeKind, type ResumeContext } from './resume'

const NOW = new Date('2026-09-28T12:00:00.000Z')
const LIVE = 'meeting-live'
const context: ResumeContext = { liveMeetingId: LIVE, clientId: 'tab-aaaaaaaaaaaaaaaa', now: NOW }
const ago = (ms: number) => new Date(NOW.getTime() - ms)

type Row = Parameters<typeof resumeKind>[0]
const row = (overrides: Partial<Row> = {}): Row => ({
  status: 'joined',
  meetingId: LIVE,
  clientId: context.clientId,
  admittedAt: ago(60_000),
  leftAt: null,
  ...overrides,
})

describe('resumeKind', () => {
  it('resumes admitted and joined rows of the live meeting with the same clientId', () => {
    expect(resumeKind(row({ status: 'joined' }), context)).toBe('grant')
    expect(resumeKind(row({ status: 'admitted' }), context)).toBe('grant')
  })

  it('never resumes with another clientId (another tab)', () => {
    expect(resumeKind(row({ clientId: 'tab-bbbbbbbbbbbbbbbb' }), context)).toBeNull()
  })

  it('never resumes rows of older meetings, and nothing without a live meeting', () => {
    expect(resumeKind(row({ meetingId: 'meeting-old' }), context)).toBeNull()
    expect(resumeKind(row(), { ...context, liveMeetingId: null })).toBeNull()
  })

  it('never resumes removed or denied rows', () => {
    expect(resumeKind(row({ status: 'removed' }), context)).toBeNull()
    expect(resumeKind(row({ status: 'denied' }), context)).toBeNull()
  })

  it('resumes a row that left moments ago (page reload), within the grace period only', () => {
    expect(resumeKind(row({ status: 'left', leftAt: ago(5_000) }), context)).toBe('grant')
    expect(resumeKind(row({ status: 'left', leftAt: ago(RESUME_GRACE_MS) }), context)).toBe('grant')
    expect(resumeKind(row({ status: 'left', leftAt: ago(RESUME_GRACE_MS + 1) }), context)).toBeNull()
  })

  it('never turns a request closed without admission into a grant', () => {
    expect(resumeKind(row({ status: 'left', admittedAt: null, leftAt: ago(1_000) }), context)).toBeNull()
  })

  it('reuses the own pending request instead of queueing twice', () => {
    expect(resumeKind(row({ status: 'waiting', admittedAt: null }), context)).toBe('waiting')
    expect(resumeKind(row({ status: 'waiting', admittedAt: null, meetingId: null }), { ...context, liveMeetingId: null })).toBe(
      'waiting',
    )
    expect(resumeKind(row({ status: 'waiting', admittedAt: null, meetingId: 'meeting-old' }), context)).toBeNull()
  })
})

describe('pickResumable', () => {
  it('takes the first resumable row (newest first)', () => {
    const rows = [row({ status: 'removed' }), row({ status: 'left', leftAt: ago(1_000) }), row({ status: 'joined' })]
    expect(pickResumable(rows, context)).toEqual({ row: rows[1], kind: 'grant' })
    expect(pickResumable([row({ status: 'denied' })], context)).toBeNull()
  })
})
