import { describe, expect, it } from 'vitest'
import { isFinalEvent, waitingEventFor, type WaitingContext } from './events'

const LIVE = 'meeting-live'
const open: WaitingContext = { liveMeetingId: LIVE, roomLocked: false, roomDeleted: false }
type Row = Parameters<typeof waitingEventFor>[0]
const row = (overrides: Partial<Row>): Row => ({ status: 'waiting', meetingId: LIVE, admittedAt: null, ...overrides })

describe('waitingEventFor', () => {
  it('keeps waiting requests of the live meeting (or of the meeting to come) waiting', () => {
    expect(waitingEventFor(row({}), open)).toEqual({ event: 'status' })
    expect(waitingEventFor(row({ meetingId: null }), { ...open, liveMeetingId: null })).toEqual({ event: 'status' })
  })

  it('admits admitted and joined rows of the live meeting only', () => {
    expect(waitingEventFor(row({ status: 'admitted', admittedAt: new Date() }), open)).toEqual({ event: 'admitted' })
    expect(waitingEventFor(row({ status: 'joined', admittedAt: new Date() }), open)).toEqual({ event: 'admitted' })
    expect(waitingEventFor(row({ status: 'admitted', meetingId: 'meeting-old' }), open)).toEqual({ event: 'ended' })
    expect(waitingEventFor(row({ status: 'admitted' }), { ...open, liveMeetingId: null })).toEqual({ event: 'ended' })
  })

  it('reports denials, removals and a lock with their reason', () => {
    expect(waitingEventFor(row({ status: 'denied' }), open)).toEqual({ event: 'denied', reason: 'denied' })
    expect(waitingEventFor(row({ status: 'removed' }), open)).toEqual({ event: 'denied', reason: 'removed' })
    expect(waitingEventFor(row({ status: 'left' }), { ...open, roomLocked: true })).toEqual({ event: 'denied', reason: 'locked' })
  })

  it('ends everything else', () => {
    expect(waitingEventFor(row({ status: 'left' }), open)).toEqual({ event: 'ended' })
    expect(waitingEventFor(row({ status: 'left', admittedAt: new Date() }), { ...open, roomLocked: true })).toEqual({ event: 'ended' })
    expect(waitingEventFor(row({ meetingId: 'meeting-old' }), open)).toEqual({ event: 'ended' })
    expect(waitingEventFor(row({}), { ...open, roomDeleted: true })).toEqual({ event: 'ended' })
    expect(waitingEventFor(row({ status: 'admitted' }), { ...open, roomDeleted: true })).toEqual({ event: 'ended' })
  })

  it('treats every event except status as final', () => {
    expect(isFinalEvent({ event: 'status' })).toBe(false)
    expect(isFinalEvent({ event: 'admitted' })).toBe(true)
    expect(isFinalEvent({ event: 'denied', reason: 'locked' })).toBe(true)
    expect(isFinalEvent({ event: 'ended' })).toBe(true)
  })
})
