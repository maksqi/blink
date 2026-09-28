/**
 * Join proof (docs/API.md §6, docs/SECURITY.md §3.1): without the right proof the server reveals nothing about the room
 * and issues no token; the key or proof is never accepted in a URL.
 */
import { describe, expect, it } from 'vitest'
import { deriveJoinProof, generateRoomKey, generateSlug } from '../../../app/lib/e2ee'
import { createClient, createRoom, createRoomInvite, createUser, expectApiError, loginAs } from '../_harness'
import { joinBody, newClientId } from '../rooms/_support'

describe('join proof', () => {
  it('rejects a wrong key with ROOM_KEY_INVALID and nothing else about the room', async () => {
    const owner = await createUser()
    const room = await createRoom(owner, { name: 'Secret board meeting' })
    const wrong = await deriveJoinProof(generateRoomKey(), room.slug)
    const invite = await createRoomInvite(room)
    for (const res of [
      await createClient().post(`/api/join/${room.slug}/info`, { body: { proof: wrong } }),
      await createClient().post(`/api/join/${room.slug}/info`, { body: { proof: wrong, inviteToken: invite.token } }),
      await createClient().post(`/api/join/${room.slug}`, { body: joinBody({ proof: wrong }, { displayName: 'Guest', inviteToken: invite.token }) }),
      // Not even the owner gets in without the key.
      await (await loginAs(owner)).post(`/api/join/${room.slug}`, { body: joinBody({ proof: wrong }) }),
    ]) {
      expectApiError(res, 403, 'ROOM_KEY_INVALID')
      expect(Object.keys(res.body.data)).toEqual(['code'])
      expect(res.text).not.toContain(room.name)
      expect(res.text).not.toContain(room.id)
    }
  })

  it('rejects a proof for the same key but another slug', async () => {
    const room = await createRoom(await createUser())
    const otherSlugProof = await deriveJoinProof(room.keyBytes, generateSlug())
    expectApiError(await createClient().post(`/api/join/${room.slug}/info`, { body: { proof: otherSlugProof } }), 403, 'ROOM_KEY_INVALID')
  })

  it('answers 404 ROOM_NOT_FOUND for unknown, malformed and deleted slugs', async () => {
    const proof = await deriveJoinProof(generateRoomKey(), generateSlug())
    expectApiError(await createClient().post(`/api/join/${generateSlug()}/info`, { body: { proof } }), 404, 'ROOM_NOT_FOUND')
    expectApiError(await createClient().post('/api/join/not-a-slug/info', { body: { proof } }), 404, 'ROOM_NOT_FOUND')
    const deleted = await createRoom(await createUser(), { deletedAt: new Date() })
    expectApiError(await createClient().post(`/api/join/${deleted.slug}/info`, { body: { proof: deleted.proof } }), 404, 'ROOM_NOT_FOUND')
  })

  it('returns JoinInfo for the right proof', async () => {
    const owner = await createUser()
    const room = await createRoom(owner, { password: 'room-pass', waitingRoom: true })
    const guest = await createClient().post(`/api/join/${room.slug}/info`, { body: { proof: room.proof } })
    expect(guest.status, guest.text).toBe(200)
    expect(guest.body).toEqual({
      roomId: room.id,
      name: room.name,
      needsPassword: true,
      waitingRoom: true,
      recordingActive: false,
      yourRole: 'participant',
      signedIn: false,
      guestsAllowed: true,
    })
    const host = await (await loginAs(owner)).post(`/api/join/${room.slug}/info`, { body: { proof: room.proof } })
    expect(host.body).toMatchObject({ yourRole: 'host', signedIn: true, needsPassword: false, waitingRoom: false })
  })

  it('never accepts the key or the proof in the URL', async () => {
    const room = await createRoom(await createUser())
    const api = createClient()
    const query = { proof: room.proof, k: room.key }
    expectApiError(await api.post(`/api/join/${room.slug}/info`, { query, body: {} }), 400, 'VALIDATION_FAILED')
    expectApiError(
      await api.post(`/api/join/${room.slug}`, { query, body: { clientId: newClientId(), displayName: 'Guest' } }),
      400,
      'VALIDATION_FAILED',
    )
    expectApiError(await api.post(`/api/join/${room.slug}/info`, { query }), 400, 'VALIDATION_FAILED')
  })

  it('validates the proof format', async () => {
    const room = await createRoom(await createUser())
    expectApiError(await createClient().post(`/api/join/${room.slug}/info`, { body: { proof: room.key.slice(0, 20) } }), 400, 'VALIDATION_FAILED')
  })
})
