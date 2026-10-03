import { describe, expect, it } from 'vitest'
import {
  muteCoveredByRevoke,
  permissionNotices,
  publishableSources,
  roleNotice,
  serverMuteMessage,
  serverMuteSource,
  type NoticeSource,
} from './notices'

const set = (...sources: NoticeSource[]) => new Set(sources)

describe('publishableSources', () => {
  it('follows LiveKit semantics', () => {
    expect(publishableSources(null)).toEqual(set('microphone', 'camera', 'screen_share'))
    expect(publishableSources({ canPublish: false, sources: ['microphone'] })).toEqual(set())
    expect(publishableSources({ canPublish: true, sources: [] })).toEqual(set('microphone', 'camera', 'screen_share'))
    expect(publishableSources({ canPublish: true, sources: ['camera', 'screen_share_audio'] })).toEqual(set('camera'))
  })
})

describe('permissionNotices', () => {
  it('reports revoked and granted sources', () => {
    expect(permissionNotices(set('microphone', 'camera'), set('camera'))).toEqual([
      { source: 'microphone', change: 'revoked', message: 'The host turned off your microphone' },
    ])
    expect(permissionNotices(set('camera'), set('microphone', 'camera', 'screen_share'))).toEqual([
      { source: 'microphone', change: 'granted', message: 'You can unmute now' },
      { source: 'screen_share', change: 'granted', message: 'You can share your screen now' },
    ])
    expect(permissionNotices(set('camera'), set('camera'))).toEqual([])
  })
})

describe('server mutes', () => {
  it('maps track sources to notices', () => {
    expect(serverMuteSource('microphone')).toBe('microphone')
    expect(serverMuteSource('screen_share_audio')).toBe('screen_share')
    expect(serverMuteSource('unknown')).toBeNull()
    expect(serverMuteMessage('microphone')).toBe('The host muted your microphone')
    expect(serverMuteMessage('camera')).toBe('The host stopped your camera')
  })

  it('lets a recent revoke cover the mute that comes with it', () => {
    expect(muteCoveredByRevoke(undefined, 10)).toBe(false)
    expect(muteCoveredByRevoke(1_000, 2_000)).toBe(true)
    expect(muteCoveredByRevoke(1_000, 5_000)).toBe(false)
  })
})

describe('roleNotice', () => {
  it('announces co-host changes only', () => {
    expect(roleNotice('participant', 'cohost')).toBe('The host made you a co-host')
    expect(roleNotice('cohost', 'participant')).toBe('You are no longer a co-host')
    expect(roleNotice(undefined, 'cohost')).toBeNull()
    expect(roleNotice('host', 'host')).toBeNull()
  })
})
