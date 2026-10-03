import { DisconnectReason } from 'livekit-client'
import { describe, expect, it } from 'vitest'
import { isTerminalPhase, outcomeForDisconnect } from './disconnect'
import { connectionQualityOf, parseAttributes, toParticipantView, type ParticipantLike } from './participant-view'

function participant(overrides: Partial<ParticipantLike> = {}): ParticipantLike {
  return {
    identity: 'p_AliceAliceAlice1',
    name: 'Alice',
    attributes: { role: 'cohost', kind: 'user', hand: '', vol: '100' },
    isLocal: false,
    isSpeaking: false,
    audioLevel: 0,
    connectionQuality: 'excellent',
    joinedAt: new Date(1_700_000_000_000),
    isMicrophoneEnabled: true,
    isCameraEnabled: false,
    isScreenShareEnabled: false,
    trackPublications: new Map([['TR_1', { isEncrypted: true }]]),
    ...overrides,
  }
}

const options = { localEncrypted: true, now: 42 }

describe('parseAttributes', () => {
  it('reads the server-set attributes', () => {
    expect(parseAttributes({ role: 'host', kind: 'user', hand: '1700000000123', vol: '25' })).toEqual({
      role: 'host',
      kind: 'user',
      handRaisedAt: 1_700_000_000_123,
      volumeForEveryone: 25,
    })
  })

  it('falls back per field to the least-privileged defaults', () => {
    expect(parseAttributes(undefined)).toEqual({
      role: 'participant',
      kind: 'guest',
      handRaisedAt: null,
      volumeForEveryone: 100,
    })
    expect(parseAttributes({ role: 'admin', kind: 'user', hand: '12', vol: '250' })).toEqual({
      role: 'participant',
      kind: 'user',
      handRaisedAt: null,
      volumeForEveryone: 100,
    })
    expect(parseAttributes({ role: 'host' }).role).toBe('host')
    expect(parseAttributes({ role: 'host' }).kind).toBe('guest')
  })
})

describe('toParticipantView', () => {
  it('projects a remote participant', () => {
    expect(toParticipantView(participant(), options)).toEqual({
      identity: 'p_AliceAliceAlice1',
      name: 'Alice',
      role: 'cohost',
      kind: 'user',
      isLocal: false,
      isSpeaking: false,
      audioLevel: 0,
      connectionQuality: 'excellent',
      micEnabled: true,
      cameraEnabled: false,
      screenSharing: false,
      handRaisedAt: null,
      volumeForEveryone: 100,
      mediaEncrypted: true,
      joinedAt: 1_700_000_000_000,
    })
  })

  it('marks a remote participant with any unencrypted publication', () => {
    const view = toParticipantView(
      participant({
        trackPublications: new Map([
          ['a', { isEncrypted: true }],
          ['b', { isEncrypted: false }],
        ]),
      }),
      options,
    )
    expect(view.mediaEncrypted).toBe(false)
  })

  it('keeps a blocked participant marked after the unencrypted publication is gone', () => {
    const encryptedOnly = participant({ trackPublications: new Map([['a', { isEncrypted: true }]]) })
    expect(toParticipantView(encryptedOnly, options).mediaEncrypted).toBe(true)
    expect(toParticipantView(encryptedOnly, { ...options, blocked: true }).mediaEncrypted).toBe(false)
  })

  it('uses the local E2EE state for the local participant', () => {
    const local = participant({ isLocal: true, trackPublications: new Map([['a', { isEncrypted: false }]]) })
    expect(toParticipantView(local, { localEncrypted: true, now: 1 }).mediaEncrypted).toBe(true)
    expect(toParticipantView(local, { localEncrypted: false, now: 1 }).mediaEncrypted).toBe(false)
  })

  it('fills gaps: empty name, missing join time, unknown quality, NaN level', () => {
    const view = toParticipantView(
      participant({ name: '  ', joinedAt: undefined, connectionQuality: 'weird', audioLevel: Number.NaN }),
      options,
    )
    expect(view).toMatchObject({ name: 'Participant', joinedAt: 42, connectionQuality: 'unknown', audioLevel: 0 })
  })

  it('maps connection qualities', () => {
    for (const quality of ['excellent', 'good', 'poor', 'lost', 'unknown'] as const) {
      expect(connectionQualityOf(quality)).toBe(quality)
    }
  })
})

describe('outcomeForDisconnect', () => {
  it('maps LiveKit reasons to phases', () => {
    expect(outcomeForDisconnect(DisconnectReason.CLIENT_INITIATED, false)).toEqual({ phase: 'left', reason: 'left' })
    expect(outcomeForDisconnect(DisconnectReason.DUPLICATE_IDENTITY, false)).toEqual({
      phase: 'left',
      reason: 'other-tab',
    })
    expect(outcomeForDisconnect(DisconnectReason.PARTICIPANT_REMOVED, false)).toEqual({
      phase: 'removed',
      reason: 'removed',
    })
    expect(outcomeForDisconnect(DisconnectReason.ROOM_DELETED, false)).toEqual({ phase: 'ended', reason: 'ended' })
    expect(outcomeForDisconnect(DisconnectReason.ROOM_CLOSED, false)).toEqual({ phase: 'ended', reason: 'ended' })
    expect(outcomeForDisconnect(DisconnectReason.SERVER_SHUTDOWN, false)).toEqual({ phase: 'error', reason: 'server' })
    expect(outcomeForDisconnect(DisconnectReason.SIGNAL_CLOSE, false)).toEqual({
      phase: 'error',
      reason: 'connection-lost',
    })
    expect(outcomeForDisconnect(undefined, false)).toEqual({ phase: 'error', reason: 'connection-lost' })
  })

  it('treats any disconnect after leave() as leaving', () => {
    expect(outcomeForDisconnect(DisconnectReason.ROOM_DELETED, true)).toEqual({ phase: 'left', reason: 'left' })
  })

  it('knows the terminal phases', () => {
    expect(['left', 'ended', 'removed', 'error'].every((p) => isTerminalPhase(p as never))).toBe(true)
    expect(isTerminalPhase('inCall')).toBe(false)
    expect(isTerminalPhase('reconnecting')).toBe(false)
  })
})
