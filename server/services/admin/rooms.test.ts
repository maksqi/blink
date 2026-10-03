import { describe, expect, it, vi } from 'vitest'
import type { LiveRoomInfo } from '../../contracts'
import { logger } from '../../utils/logger'
import { createFakeRoomService } from '../livekit/fake-room-service'
import { fetchLiveRooms, mergeLiveState, type AdminRoomRow } from './rooms'

const created = new Date('2026-09-01T10:00:00.000Z')

function row(overrides: Partial<AdminRoomRow> = {}): AdminRoomRow {
  return {
    id: '01890000-0000-7000-8000-000000000001',
    slug: 'abc-defg-hjk',
    name: 'Weekly sync',
    ephemeral: false,
    createdAt: created,
    lastActiveAt: null,
    owner: { id: '01890000-0000-7000-8000-0000000000aa', displayName: 'Ada', email: 'ada@example.test' },
    liveInDb: false,
    joinedInDb: 0,
    ...overrides,
  }
}

function liveRoom(name: string, numParticipants: number): LiveRoomInfo {
  return { name, sid: `RM_${name.slice(-4)}`, numParticipants, createdAt: created, metadata: '{}' }
}

describe('mergeLiveState', () => {
  it('takes live state and counts from LiveKit when it answered', () => {
    const live = row({ id: 'a', liveInDb: true, joinedInDb: 7 })
    const idle = row({ id: 'b' })
    const items = mergeLiveState([live, idle], new Map([['a', liveRoom('a', 3)]]))
    expect(items.map((item) => [item.id, item.live, item.participantCount])).toEqual([
      ['a', true, 3],
      ['b', false, 0],
    ])
  })

  it('trusts LiveKit over a stale meeting row', () => {
    const [item] = mergeLiveState([row({ liveInDb: true, joinedInDb: 2 })], new Map())
    expect(item).toMatchObject({ live: false, participantCount: 0 })
  })

  it('falls back to the meeting row and joined rows when LiveKit failed', () => {
    const items = mergeLiveState(
      [row({ id: 'a', liveInDb: true, joinedInDb: 4 }), row({ id: 'b', liveInDb: false, joinedInDb: 9 })],
      null,
    )
    expect(items.map((item) => [item.id, item.live, item.participantCount])).toEqual([
      ['a', true, 4],
      ['b', false, 0],
    ])
  })

  it('returns exactly the AdminRoom fields with ISO dates (no keys, proofs or tokens)', () => {
    const [item] = mergeLiveState([row({ lastActiveAt: new Date('2026-09-02T08:30:00.000Z') })], null)
    expect(Object.keys(item!).sort()).toEqual(
      ['createdAt', 'ephemeral', 'id', 'lastActiveAt', 'live', 'name', 'owner', 'participantCount', 'slug'].sort(),
    )
    expect(Object.keys(item!.owner).sort()).toEqual(['displayName', 'email', 'id'])
    expect(item!.createdAt).toBe('2026-09-01T10:00:00.000Z')
    expect(item!.lastActiveAt).toBe('2026-09-02T08:30:00.000Z')
  })
})

describe('fetchLiveRooms', () => {
  it('asks LiveKit only for the given rooms and indexes them by name', async () => {
    const fake = createFakeRoomService()
    for (const name of ['r1', 'r2', 'other']) {
      await fake.createRoom({ name, maxParticipants: 25, emptyTimeoutSec: 1, departureTimeoutSec: 1, metadata: '' })
    }
    await fake.getParticipant('r1', 'p_one')
    await fake.getParticipant('r1', 'p_two')
    const live = await fetchLiveRooms(fake, ['r1', 'r2', 'missing'])
    expect([...live!.keys()].sort()).toEqual(['r1', 'r2'])
    expect(live!.get('r1')!.numParticipants).toBe(2)
    expect(fake.calls.find((call) => call.method === 'listRooms')!.args).toEqual([['r1', 'r2', 'missing']])
  })

  it('answers null instead of throwing when LiveKit fails', async () => {
    const failing = {
      listRooms: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:7880')),
    }
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    try {
      await expect(fetchLiveRooms(failing, ['r1'])).resolves.toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    } finally {
      warn.mockRestore()
    }
  })

  it('does not call LiveKit for an empty page', async () => {
    const fake = createFakeRoomService()
    expect((await fetchLiveRooms(fake, []))!.size).toBe(0)
    expect(fake.calls).toEqual([])
  })
})
