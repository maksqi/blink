import { describe, expect, it, vi } from 'vitest'
import type { RoomDetails } from '#shared/schemas/rooms'
import { deriveJoinProof, encodeRoomKey, generateRoomKey, isValidSlug } from '../e2ee/keys'
import { createRoomWithKey, newRoomKey, type CreateRoomBody } from './create-room'

const ROOM = { id: '0190a1b2-c3d4-7e5f-8a9b-00000000000a', keyVersion: 1 } as RoomDetails
const slugTaken = Object.assign(new Error('taken'), { code: 'CONFLICT' })
const isSlugTaken = (error: unknown) => (error as { code?: string }).code === 'CONFLICT'

describe('createRoomWithKey', () => {
  it('sends the slug and the join proof, never the key', async () => {
    const post = vi.fn(async (_body: CreateRoomBody) => ({ room: ROOM }))
    const { room, key } = await createRoomWithKey({ name: 'Standup', ephemeral: false }, { post, isSlugTaken })

    expect(room).toBe(ROOM)
    const body = post.mock.calls[0]![0]
    expect(isValidSlug(body.slug)).toBe(true)
    expect(body).toMatchObject({ name: 'Standup', ephemeral: false })
    expect(body.proof).toBe(await deriveJoinProof(key, body.slug))
    expect(JSON.stringify(body)).not.toContain(encodeRoomKey(key))
    expect(Object.keys(body).sort()).toEqual(['ephemeral', 'name', 'proof', 'slug'])
  })

  it('retries once with a new slug and a new key when the slug is taken', async () => {
    const post = vi
      .fn<(body: CreateRoomBody) => Promise<{ room: RoomDetails }>>()
      .mockRejectedValueOnce(slugTaken)
      .mockResolvedValueOnce({ room: ROOM })
    const { key } = await createRoomWithKey({ name: 'Standup', ephemeral: true }, { post, isSlugTaken })

    expect(post).toHaveBeenCalledTimes(2)
    const [first, second] = post.mock.calls.map((call) => call[0])
    expect(second!.slug).not.toBe(first!.slug)
    expect(second!.proof).not.toBe(first!.proof)
    expect(second!.proof).toBe(await deriveJoinProof(key, second!.slug))
    expect(second!.ephemeral).toBe(true)
  })

  it('gives up after the second taken slug', async () => {
    const post = vi.fn().mockRejectedValue(slugTaken)
    await expect(createRoomWithKey({ name: 'x', ephemeral: false }, { post, isSlugTaken })).rejects.toBe(slugTaken)
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('does not retry other errors', async () => {
    const limit = Object.assign(new Error('limit'), { code: 'ROOM_LIMIT_REACHED' })
    const post = vi.fn().mockRejectedValue(limit)
    await expect(createRoomWithKey({ name: 'x', ephemeral: false }, { post, isSlugTaken })).rejects.toBe(limit)
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('passes optional settings through', async () => {
    const post = vi.fn(async (_body: CreateRoomBody) => ({ room: ROOM }))
    await createRoomWithKey(
      { name: 'x', ephemeral: false, waitingRoom: false, allowGuests: true, password: 'secret-pass' },
      { post, isSlugTaken, generateSlug: () => 'abc-defg-hjk' },
    )
    expect(post.mock.calls[0]![0]).toMatchObject({ slug: 'abc-defg-hjk', waitingRoom: false, password: 'secret-pass' })
  })
})

describe('newRoomKey', () => {
  it('makes a fresh key and its proof for rotation', async () => {
    const fixed = generateRoomKey()
    const { key, proof } = await newRoomKey('abc-defg-hjk', { generateRoomKey: () => fixed })
    expect(key).toBe(fixed)
    expect(proof).toBe(await deriveJoinProof(fixed, 'abc-defg-hjk'))
    const other = await newRoomKey('abc-defg-hjk')
    expect(encodeRoomKey(other.key)).not.toBe(encodeRoomKey(fixed))
  })
})
