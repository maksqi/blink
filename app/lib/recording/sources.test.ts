import { describe, expect, it } from 'vitest'
import {
  drawableVideo,
  mixableAudio,
  recordable,
  sourceKey,
  type RemotePublicationFacts,
  type TrackLike,
} from './sources'

const track = (id: string, readyState: MediaStreamTrackState = 'live'): TrackLike => ({ id, readyState })

function pub(
  identity: string,
  source: RemotePublicationFacts['source'],
  overrides: Partial<RemotePublicationFacts> = {},
): RemotePublicationFacts {
  const kind = source === 'microphone' || source === 'screen_share_audio' ? 'audio' : 'video'
  return {
    identity,
    source,
    kind,
    encrypted: true,
    subscribed: true,
    muted: false,
    track: track(`${identity}-${source}`),
    ...overrides,
  }
}

describe('recordable', () => {
  it('needs encryption, a subscription, no mute and a live track', () => {
    expect(recordable(pub('p_a', 'camera'))).toBe(true)
    expect(recordable(pub('p_a', 'camera', { encrypted: false }))).toBe(false)
    expect(recordable(pub('p_a', 'camera', { subscribed: false }))).toBe(false)
    expect(recordable(pub('p_a', 'camera', { muted: true }))).toBe(false)
    expect(recordable(pub('p_a', 'camera', { track: null }))).toBe(false)
    expect(recordable(pub('p_a', 'camera', { track: track('x', 'ended') }))).toBe(false)
  })
})

describe('drawableVideo', () => {
  it('draws encrypted, subscribed cameras and screen shares', () => {
    const drawn = drawableVideo([pub('p_a', 'camera'), pub('p_b', 'screen_share')])
    expect([...drawn.keys()]).toEqual([sourceKey('p_a', 'camera'), sourceKey('p_b', 'screen_share')])
    expect(drawn.get('p_a:camera')).toMatchObject({ identity: 'p_a', source: 'camera', local: false })
  })

  it('never draws an unencrypted publication, even when it is subscribed and has a track', () => {
    const drawn = drawableVideo([
      pub('p_mallory', 'camera', { encrypted: false }),
      pub('p_mallory', 'screen_share', { encrypted: false }),
    ])
    expect(drawn.size).toBe(0)
  })

  it('never draws an unsubscribed or muted publication', () => {
    const drawn = drawableVideo([
      pub('p_a', 'camera', { subscribed: false }),
      pub('p_b', 'camera', { muted: true }),
      pub('p_c', 'camera', { track: null }),
    ])
    expect(drawn.size).toBe(0)
  })

  it('ignores audio and unknown sources', () => {
    const drawn = drawableVideo([pub('p_a', 'microphone'), pub('p_a', 'unknown', { kind: 'video' })])
    expect(drawn.size).toBe(0)
  })

  it("adds the local camera and screen share as the recorder's own media", () => {
    const drawn = drawableVideo(
      [pub('p_remote', 'camera')],
      [
        { identity: 'p_me', source: 'camera', track: track('cam') },
        { identity: 'p_me', source: 'screen_share', track: track('screen') },
        { identity: 'p_me', source: 'camera', track: null },
      ],
    )
    expect(drawn.get('p_me:camera')).toMatchObject({ local: true, track: { id: 'cam' } })
    expect(drawn.get('p_me:screen_share')).toMatchObject({ local: true, track: { id: 'screen' } })
    expect(drawn.get('p_remote:camera')?.local).toBe(false)
  })

  it('skips an ended local track', () => {
    const drawn = drawableVideo([], [{ identity: 'p_me', source: 'camera', track: track('cam', 'ended') }])
    expect(drawn.size).toBe(0)
  })
})

describe('mixableAudio', () => {
  it('mixes verified tracks of encrypted, subscribed audio publications with their identity', () => {
    const publications = [pub('p_a', 'microphone'), pub('p_b', 'screen_share_audio')]
    const mixed = mixableAudio(publications, [track('p_a-microphone'), track('p_b-screen_share_audio')])
    expect(mixed).toEqual([
      { identity: 'p_a', source: 'microphone', track: publications[0]!.track },
      { identity: 'p_b', source: 'screen_share_audio', track: publications[1]!.track },
    ])
  })

  it('never mixes an unencrypted publication, even when its track shows up in the verified list', () => {
    const mixed = mixableAudio([pub('p_mallory', 'microphone', { encrypted: false })], [track('p_mallory-microphone')])
    expect(mixed).toEqual([])
  })

  it('never mixes an unsubscribed or muted publication', () => {
    const mixed = mixableAudio(
      [pub('p_a', 'microphone', { subscribed: false }), pub('p_b', 'microphone', { muted: true })],
      [track('p_a-microphone'), track('p_b-microphone')],
    )
    expect(mixed).toEqual([])
  })

  it('drops tracks call-core did not verify and verified tracks no publication claims', () => {
    expect(mixableAudio([pub('p_a', 'microphone')], [])).toEqual([])
    expect(mixableAudio([], [track('stray')])).toEqual([])
  })

  it('drops ended tracks', () => {
    expect(mixableAudio([pub('p_a', 'microphone')], [track('p_a-microphone', 'ended')])).toEqual([])
  })

  it('ignores video publications', () => {
    expect(mixableAudio([pub('p_a', 'camera')], [track('p_a-camera')])).toEqual([])
  })
})
