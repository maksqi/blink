import { EventEmitter } from 'node:events'
import { RoomEvent, Track, type Room } from 'livekit-client'
import { describe, expect, it, vi } from 'vitest'
import { createEventBus } from '../call/event-bus'
import { SubscriptionManager } from './subscription-manager'

/** A remote publication with the parts the applier uses. */
class FakePublication {
  isDesired = false
  isEnabled = true
  track: object | null = null
  constructor(
    readonly trackSid: string,
    readonly kind: Track.Kind,
    readonly source: Track.Source,
    readonly isEncrypted: boolean,
  ) {}
  setSubscribed(subscribed: boolean) {
    this.isDesired = subscribed
    this.track = subscribed ? {} : null
  }
  setEnabled(enabled: boolean) {
    this.isEnabled = enabled
  }
  setVideoDimensions() {}
  emitTrackUpdate() {}
}

class FakeParticipant {
  readonly isLocal = false
  readonly trackPublications = new Map<string, FakePublication>()
  constructor(readonly identity: string) {}
  publish(publication: FakePublication) {
    this.trackPublications.set(publication.trackSid, publication)
    return publication
  }
}

function setup() {
  const room = new EventEmitter() as EventEmitter & { remoteParticipants: Map<string, FakeParticipant> }
  room.remoteParticipants = new Map()
  const events = createEventBus()
  const blockedEvents: string[] = []
  events.on('unencrypted.blocked', ({ identity }) => blockedEvents.push(identity))
  const onBlocked = vi.fn()
  const manager = new SubscriptionManager({
    room: room as unknown as Room,
    events,
    localEncrypted: () => true,
    onBlocked,
    delayMs: 0,
  })
  const join = (identity: string) => {
    const participant = new FakeParticipant(identity)
    room.remoteParticipants.set(identity, participant)
    return participant
  }
  return { room, manager, onBlocked, blockedEvents, join }
}

const camera = (sid: string, encrypted = true) =>
  new FakePublication(sid, Track.Kind.Video, Track.Source.Camera, encrypted)
const mic = (sid: string, encrypted = true) =>
  new FakePublication(sid, Track.Kind.Audio, Track.Source.Microphone, encrypted)
const screen = (sid: string, encrypted = true) =>
  new FakePublication(sid, Track.Kind.Video, Track.Source.ScreenShare, encrypted)

describe('SubscriptionManager sticky block (F-015)', () => {
  it('unsubscribes every track of a participant at once when one publication is unencrypted', () => {
    const { room, manager, onBlocked, blockedEvents, join } = setup()
    const xena = join('p_xena')
    const xCamera = xena.publish(camera('TR_xc'))
    const xMic = xena.publish(mic('TR_xm'))
    const alice = join('p_alice')
    const aMic = alice.publish(mic('TR_am'))
    manager.start()
    manager.apply()
    expect([xCamera.isDesired, xMic.isDesired, aMic.isDesired]).toEqual([true, true, true])

    const fake = xena.publish(screen('TR_xs', false))
    room.emit(RoomEvent.TrackPublished, fake, xena)
    // Applied synchronously, not on the next coalesced pass.
    expect([xCamera.isDesired, xMic.isDesired, fake.isDesired]).toEqual([false, false, false])
    expect(aMic.isDesired).toBe(true)
    expect(manager.isBlocked('p_xena')).toBe(true)
    expect(manager.plan.blockedIdentities).toEqual(['p_xena'])
    expect(onBlocked).toHaveBeenCalledExactlyOnceWith('p_xena')
    expect(blockedEvents).toEqual(['p_xena'])

    // The unencrypted publication goes away: the block stays.
    xena.trackPublications.delete('TR_xs')
    room.emit(RoomEvent.TrackUnpublished, fake, xena)
    manager.apply()
    expect([xCamera.isDesired, xMic.isDesired]).toEqual([false, false])
    expect(manager.plan.blockedIdentities).toEqual(['p_xena'])
    expect(manager.plan.decisions.filter((d) => d.identity === 'p_xena').every((d) => d.blocked)).toBe(true)
    expect(onBlocked).toHaveBeenCalledTimes(1)
  })

  it('blocks a remote participant whose encryption livekit-client reports as off, even before start', () => {
    const { room, manager, onBlocked, join } = setup()
    const xena = join('p_xena')
    const xCamera = xena.publish(camera('TR_xc'))
    room.emit(RoomEvent.ParticipantEncryptionStatusChanged, false, xena)
    room.emit(RoomEvent.ParticipantEncryptionStatusChanged, false, { identity: 'p_me', isLocal: true })
    expect(manager.isBlocked('p_xena')).toBe(true)
    expect(manager.isBlocked('p_me')).toBe(false)
    expect(onBlocked).toHaveBeenCalledExactlyOnceWith('p_xena')
    manager.start()
    manager.apply()
    expect(xCamera.isDesired).toBe(false)
    // Encryption reported on again does not lift it.
    room.emit(RoomEvent.ParticipantEncryptionStatusChanged, true, xena)
    manager.apply()
    expect(xCamera.isDesired).toBe(false)
  })

  it('reports only blocked people who are in the call, and blocks them again when they return', () => {
    const { room, manager, join } = setup()
    const xena = join('p_xena')
    xena.publish(screen('TR_xs', false))
    manager.start()
    manager.apply()
    expect(manager.plan.blockedIdentities).toEqual(['p_xena'])

    room.remoteParticipants.delete('p_xena')
    manager.apply()
    expect(manager.plan.blockedIdentities).toEqual([])

    const back = join('p_xena')
    const backCamera = back.publish(camera('TR_xc2'))
    manager.apply()
    expect(manager.plan.blockedIdentities).toEqual(['p_xena'])
    expect(backCamera.isDesired).toBe(false)
  })

  it('stops listening on dispose', () => {
    const { room, manager, onBlocked, join } = setup()
    manager.start()
    manager.dispose()
    room.emit(RoomEvent.ParticipantEncryptionStatusChanged, false, join('p_xena'))
    expect(onBlocked).not.toHaveBeenCalled()
    expect(room.listenerCount(RoomEvent.ParticipantEncryptionStatusChanged)).toBe(0)
    expect(room.listenerCount(RoomEvent.TrackPublished)).toBe(0)
  })
})
