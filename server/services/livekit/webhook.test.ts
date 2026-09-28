import { describe, expect, it } from 'vitest'
import { roomMetadataSchema } from '#shared/schemas/livekit'
import { buildRoomMetadata } from './metadata'
import { createEventDeduper, WEBHOOK_DEDUPE_TTL_MS } from './webhook'

describe('webhook deduplication', () => {
  it('accepts an event id once within 10 minutes', () => {
    let now = 0
    const deduper = createEventDeduper({ now: () => now })
    expect(WEBHOOK_DEDUPE_TTL_MS).toBe(600_000)
    expect(deduper.claim('EV_1')).toBe(true)
    expect(deduper.claim('EV_1')).toBe(false)
    expect(deduper.claim('EV_2')).toBe(true)
    now = WEBHOOK_DEDUPE_TTL_MS - 1
    expect(deduper.claim('EV_1')).toBe(false)
    now = WEBHOOK_DEDUPE_TTL_MS
    expect(deduper.claim('EV_1')).toBe(true)
  })

  it('forgets a released id so a retry can run', () => {
    const deduper = createEventDeduper()
    expect(deduper.claim('EV_1')).toBe(true)
    deduper.release('EV_1')
    expect(deduper.claim('EV_1')).toBe(true)
  })

  it('stays bounded', () => {
    const deduper = createEventDeduper({ maxEntries: 3 })
    for (let i = 0; i < 10; i++) deduper.claim(`EV_${i}`)
    expect(deduper.size).toBe(3)
    expect(deduper.claim('EV_9')).toBe(false)
    expect(deduper.claim('EV_0')).toBe(true)
  })
})

describe('room metadata', () => {
  const room = { locked: true, waitingRoom: false, screenSharePolicy: 'hosts', allowSelfUnmute: false, chatEnabled: true } as const
  const meeting = { epoch: 'AAAAAAAAAAAAAAAAAAAAAA' }

  it('is built from the database state and matches the contract', () => {
    const startedAt = new Date('2026-09-28T12:00:00.000Z')
    const metadata = buildRoomMetadata(room, meeting, { mode: 'local', by: 'Ada', startedAt })
    expect(metadata).toEqual({
      v: 1,
      epoch: meeting.epoch,
      locked: true,
      waitingRoom: false,
      screenSharePolicy: 'hosts',
      allowSelfUnmute: false,
      chatEnabled: true,
      recording: { mode: 'local', by: 'Ada', startedAt: startedAt.toISOString() },
    })
    expect(roomMetadataSchema.parse(metadata)).toEqual(metadata)
    expect(buildRoomMetadata(room, meeting, null).recording).toBeNull()
  })
})
