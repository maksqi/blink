import { describe, expect, it } from 'vitest'
import { createFakeRoomService, FAKE_MAX_CALLS } from './fake-room-service'
import { isLivekitNotFound } from './room-service'

const AT = new Date('2026-09-28T12:00:00.000Z')

describe('fake RoomServiceAdapter', () => {
  it('records every call JSON-friendly', async () => {
    const fake = createFakeRoomService({ now: () => AT })
    await fake.createRoom({ name: 'r1', maxParticipants: 25, emptyTimeoutSec: 300, departureTimeoutSec: 20, metadata: '{}' })
    await fake.sendData('r1', new TextEncoder().encode('{"type":"lobby.changed"}'), {
      topic: 'blinq.srv.v1',
      destinationIdentities: ['p_a'],
    })
    await fake.removeParticipant('r1', 'p_a', { revokeTokensIssuedBefore: AT })
    expect(fake.calls).toEqual([
      {
        method: 'createRoom',
        args: [{ name: 'r1', maxParticipants: 25, emptyTimeoutSec: 300, departureTimeoutSec: 20, metadata: '{}' }],
        at: AT.toISOString(),
      },
      {
        method: 'sendData',
        args: ['r1', '{"type":"lobby.changed"}', { topic: 'blinq.srv.v1', destinationIdentities: ['p_a'] }],
        at: AT.toISOString(),
      },
      { method: 'removeParticipant', args: ['r1', 'p_a', { revokeTokensIssuedBefore: AT.toISOString() }], at: AT.toISOString() },
    ])
  })

  it('behaves like the real adapter for missing rooms and participants', async () => {
    const fake = createFakeRoomService()
    expect(await fake.getParticipant('missing', 'p_a')).toBeNull()
    expect(await fake.listParticipants('missing')).toEqual([])
    await expect(fake.deleteRoom('missing')).resolves.toBeUndefined()
    await expect(fake.removeParticipant('missing', 'p_a')).resolves.toBeUndefined()
    const error = await fake.updateRoomMetadata('missing', '{}').catch((e: unknown) => e)
    expect(isLivekitNotFound(error)).toBe(true)
  })

  it('synthesizes connected participants with a microphone and a camera until they are removed', async () => {
    const fake = createFakeRoomService()
    const { sid } = await fake.createRoom({ name: 'r', maxParticipants: 2, emptyTimeoutSec: 1, departureTimeoutSec: 1, metadata: '' })
    expect((await fake.createRoom({ name: 'r', maxParticipants: 2, emptyTimeoutSec: 1, departureTimeoutSec: 1, metadata: '' })).sid).toBe(sid)
    const p = await fake.getParticipant('r', 'p_a')
    expect(p?.tracks.map((t) => [t.source, t.muted])).toEqual([
      ['microphone', false],
      ['camera', false],
    ])
    await fake.mutePublishedTrack('r', 'p_a', 'TR_microphone_p_a')
    expect((await fake.getParticipant('r', 'p_a'))?.tracks[0]?.muted).toBe(true)
    await fake.updateParticipant('r', 'p_a', { name: 'Ada', attributes: { hand: '1790000000000', vol: '50' } })
    await fake.updateParticipant('r', 'p_a', { attributes: { hand: '' } })
    expect(await fake.getParticipant('r', 'p_a')).toMatchObject({ name: 'Ada', attributes: { vol: '50' } })
    await fake.removeParticipant('r', 'p_a')
    expect(await fake.getParticipant('r', 'p_a')).toBeNull()
    expect(isLivekitNotFound(await fake.updateParticipant('r', 'p_a', { name: 'x' }).catch((e: unknown) => e))).toBe(true)
    fake.simulateTracks('r', 'p_b', [{ source: 'screen_share' }, { source: 'screen_share_audio', muted: true }])
    expect((await fake.getParticipant('r', 'p_b'))?.tracks.map((t) => t.sid)).toEqual(['TR_screen_share_p_b', 'TR_screen_share_audio_p_b'])
    await fake.deleteRoom('r')
    expect(fake.hasRoom('r')).toBe(false)
  })

  it('refuses a broadcast and caps its log', async () => {
    const fake = createFakeRoomService({ maxCalls: 3 })
    await fake.createRoom({ name: 'r', maxParticipants: 2, emptyTimeoutSec: 1, departureTimeoutSec: 1, metadata: '' })
    await expect(fake.sendData('r', new Uint8Array(), { topic: 't', destinationIdentities: [] })).rejects.toThrow(/broadcast/)
    for (let i = 0; i < 5; i++) await fake.listRooms()
    expect(fake.calls).toHaveLength(3)
    expect(FAKE_MAX_CALLS).toBeGreaterThan(1000)
  })
})
