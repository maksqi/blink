/**
 * Participant-side moderation notices (pure): what to tell the local participant when the host changed their publish
 * permissions or server-muted one of their tracks. The notices only inform; nothing here turns media on.
 */

export type NoticeSource = 'microphone' | 'camera' | 'screen_share'

/** LiveKit `Track.Source` names that matter for notices (screen-share audio follows screen share). */
const SOURCES: readonly NoticeSource[] = ['microphone', 'camera', 'screen_share']

export interface PermissionLike {
  canPublish: boolean
  /** `Track.Source` names (`Track.sourceFromProto` of `canPublishSources`). */
  sources: readonly string[]
}

/** The sources the local participant may publish. LiveKit treats an empty list with `canPublish` as "everything". */
export function publishableSources(permission: PermissionLike | null | undefined): Set<NoticeSource> {
  if (!permission) return new Set(SOURCES)
  if (!permission.canPublish) return new Set()
  if (permission.sources.length === 0) return new Set(SOURCES)
  return new Set(SOURCES.filter((source) => permission.sources.includes(source)))
}

export interface PermissionNotice {
  source: NoticeSource
  change: 'revoked' | 'granted'
  message: string
}

const REVOKED: Record<NoticeSource, string> = {
  microphone: 'The host turned off your microphone',
  camera: 'The host turned off your camera',
  screen_share: 'The host turned off screen sharing for you',
}

const GRANTED: Record<NoticeSource, string> = {
  microphone: 'You can unmute now',
  camera: 'You can turn on your camera now',
  screen_share: 'You can share your screen now',
}

const MUTED: Record<NoticeSource, string> = {
  microphone: 'The host muted your microphone',
  camera: 'The host stopped your camera',
  screen_share: 'The host stopped your screen share',
}

export function permissionNotices(
  previous: ReadonlySet<NoticeSource>,
  next: ReadonlySet<NoticeSource>,
): PermissionNotice[] {
  const notices: PermissionNotice[] = []
  for (const source of SOURCES) {
    if (previous.has(source) && !next.has(source)) notices.push({ source, change: 'revoked', message: REVOKED[source] })
    if (!previous.has(source) && next.has(source)) notices.push({ source, change: 'granted', message: GRANTED[source] })
  }
  return notices
}

/** The notice for a server mute of one local track source, or null for sources without one. */
export function serverMuteSource(trackSource: string): NoticeSource | null {
  if (trackSource === 'microphone' || trackSource === 'camera' || trackSource === 'screen_share') return trackSource
  if (trackSource === 'screen_share_audio') return 'screen_share'
  return null
}

export function serverMuteMessage(source: NoticeSource): string {
  return MUTED[source]
}

/** A revoke also server-mutes the source; within this window only the revoke notice shows. */
export const REVOKE_MUTE_WINDOW_MS = 3_000

export function muteCoveredByRevoke(revokedAt: number | undefined, now: number): boolean {
  return revokedAt !== undefined && now - revokedAt < REVOKE_MUTE_WINDOW_MS
}

export function roleNotice(previous: string | undefined, next: string | undefined): string | null {
  if (!previous || !next || previous === next) return null
  if (next === 'cohost') return 'The host made you a co-host'
  if (previous === 'cohost' && next === 'participant') return 'You are no longer a co-host'
  return null
}
