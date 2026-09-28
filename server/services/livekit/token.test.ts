import { TokenVerifier, TrackSource } from 'livekit-server-sdk'
import { describe, expect, it } from 'vitest'
import { participantAttributesSchema } from '#shared/schemas/livekit'
import type { ParticipantRole } from '#shared/schemas/livekit'
import {
  buildParticipantToken,
  handAttribute,
  isIdentity,
  newIdentity,
  participantAttributes,
  permissionSpec,
  publishSources,
  TOKEN_TTL_SEC,
  videoGrant,
  type ParticipantTokenInput,
} from './token'

const API_KEY = 'unit-key'
const API_SECRET = 'unit-secret-unit-secret-unit-secret-0000'
const ALL = ['camera', 'microphone', 'screen_share', 'screen_share_audio']
const FORBIDDEN_GRANTS = ['hidden', 'roomAdmin', 'roomCreate', 'roomList', 'roomRecord', 'recorder', 'agent', 'ingressAdmin']

function input(overrides: Partial<ParticipantTokenInput> = {}): ParticipantTokenInput {
  return {
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    roomName: '0192d2f4-7a3b-7cde-8f01-23456789abcd',
    identity: newIdentity(),
    name: 'Ada',
    role: 'participant',
    kind: 'guest',
    micAllowed: true,
    cameraAllowed: true,
    handRaisedAt: null,
    volumeLevel: 100,
    policy: { screenSharePolicy: 'everyone' },
    ...overrides,
  }
}

async function claims(token: string) {
  return new TokenVerifier(API_KEY, API_SECRET).verify(token)
}

describe('identities', () => {
  it('are p_ plus 16 base62 characters and random', () => {
    const ids = new Set(Array.from({ length: 200 }, newIdentity))
    expect(ids.size).toBe(200)
    for (const id of ids) expect(id).toMatch(/^p_[A-Za-z0-9]{16}$/)
    expect(isIdentity('p_0123456789abcdef')).toBe(true)
    expect(isIdentity('p_0123456789abcde')).toBe(false)
    expect(isIdentity('user@example.test')).toBe(false)
  })
})

describe('publish sources (grant matrix)', () => {
  const cases: Array<{
    role: ParticipantRole
    mic: boolean
    camera: boolean
    policy: 'everyone' | 'hosts'
    expected: string[]
  }> = [
    { role: 'host', mic: false, camera: false, policy: 'hosts', expected: ALL },
    { role: 'host', mic: true, camera: true, policy: 'everyone', expected: ALL },
    { role: 'cohost', mic: false, camera: false, policy: 'hosts', expected: ALL },
    { role: 'participant', mic: true, camera: true, policy: 'everyone', expected: ALL },
    { role: 'participant', mic: true, camera: true, policy: 'hosts', expected: ['camera', 'microphone'] },
    { role: 'participant', mic: false, camera: true, policy: 'everyone', expected: ['camera', 'screen_share', 'screen_share_audio'] },
    { role: 'participant', mic: true, camera: false, policy: 'hosts', expected: ['microphone'] },
    { role: 'participant', mic: false, camera: false, policy: 'hosts', expected: [] },
  ]

  it.each(cases)('$role mic=$mic camera=$camera policy=$policy', ({ role, mic, camera, policy, expected }) => {
    expect(publishSources({ role, micAllowed: mic, cameraAllowed: camera }, { screenSharePolicy: policy })).toEqual(expected)
  })

  it('never grants screen-share audio without screen share', () => {
    for (const c of cases) {
      const sources = publishSources({ role: c.role, micAllowed: c.mic, cameraAllowed: c.camera }, { screenSharePolicy: c.policy })
      expect(sources.includes('screen_share_audio')).toBe(sources.includes('screen_share'))
    }
  })

  it('builds the complete permission object for updates', () => {
    expect(permissionSpec({ role: 'participant', micAllowed: false, cameraAllowed: false }, { screenSharePolicy: 'hosts' })).toEqual({
      canSubscribe: true,
      canPublish: false,
      canPublishData: true,
      canPublishSources: [],
      canUpdateMetadata: false,
      hidden: false,
    })
    expect(permissionSpec({ role: 'cohost', micAllowed: false, cameraAllowed: false }, { screenSharePolicy: 'hosts' })).toMatchObject({
      canPublish: true,
      canPublishSources: ALL,
    })
  })
})

describe('buildParticipantToken', () => {
  it('grants exactly roomJoin, room, subscribe, data and the allowed sources for 5 minutes', async () => {
    const i = input({ role: 'participant', micAllowed: false, policy: { screenSharePolicy: 'hosts' } })
    const c = await claims(await buildParticipantToken(i))
    expect(c.sub).toBe(i.identity)
    expect(c.name).toBe('Ada')
    expect(c.video).toEqual({
      roomJoin: true,
      room: i.roomName,
      canSubscribe: true,
      canPublish: true,
      canPublishSources: ['camera'],
      canPublishData: true,
      canUpdateOwnMetadata: false,
    })
    expect(c.kind).toBeUndefined()
    expect(c.metadata).toBeUndefined()
    expect(c.exp! - c.nbf!).toBeGreaterThanOrEqual(TOKEN_TTL_SEC - 1)
    expect(c.exp! - c.nbf!).toBeLessThanOrEqual(TOKEN_TTL_SEC)
    expect(TOKEN_TTL_SEC).toBe(300)
  })

  it.each(['host', 'cohost', 'participant'] as const)('never sets a forbidden grant for a %s', async (role) => {
    for (const kind of ['user', 'guest'] as const) {
      const c = await claims(await buildParticipantToken(input({ role, kind })))
      for (const grant of FORBIDDEN_GRANTS) expect((c.video as Record<string, unknown>)[grant], grant).toBeUndefined()
      expect(c.video?.canUpdateOwnMetadata).toBe(false)
      expect(c.kind).toBeUndefined()
    }
  })

  it('sets canPublish false when nothing may be published', async () => {
    const c = await claims(
      await buildParticipantToken(input({ micAllowed: false, cameraAllowed: false, policy: { screenSharePolicy: 'hosts' } })),
    )
    expect(c.video).toMatchObject({ canPublish: false, canPublishSources: [], canSubscribe: true, canPublishData: true })
  })

  it('carries the server-set attributes', async () => {
    const raised = new Date('2026-09-28T10:00:00.123Z')
    const c = await claims(
      await buildParticipantToken(input({ role: 'cohost', kind: 'user', handRaisedAt: raised, volumeLevel: 25 })),
    )
    expect(c.attributes).toEqual({ role: 'cohost', kind: 'user', hand: String(raised.getTime()), vol: '25' })
    expect(participantAttributesSchema.parse(c.attributes)).toEqual(c.attributes)
  })

  it('refuses identities that are not p_ + 16 base62', async () => {
    await expect(buildParticipantToken(input({ identity: 'alice' }))).rejects.toThrow(TypeError)
  })

  it('maps sources to LiveKit track sources', () => {
    expect(videoGrant(input()).canPublishSources).toEqual([
      TrackSource.CAMERA,
      TrackSource.MICROPHONE,
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO,
    ])
  })
})

describe('attributes', () => {
  it('formats hand and volume like the contract', () => {
    expect(handAttribute(null)).toBe('')
    expect(handAttribute(new Date(1_790_000_000_000))).toBe('1790000000000')
    const attributes = participantAttributes({ role: 'participant', kind: 'guest', handRaisedAt: null, volumeLevel: 0 })
    expect(attributes).toEqual({ role: 'participant', kind: 'guest', hand: '', vol: '0' })
    expect(participantAttributes({ role: 'host', kind: 'user', handRaisedAt: null, volumeLevel: 140 }).vol).toBe('100')
    expect(participantAttributesSchema.safeParse(attributes).success).toBe(true)
  })
})
