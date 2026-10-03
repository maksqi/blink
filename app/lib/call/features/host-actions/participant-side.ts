/**
 * The participant side of moderation, wired in the feature's `setup(ctx)` (it runs during pre-join, before the room
 * connects, so room listeners attach when the call starts):
 *
 * - `server.hint` `ask-unmute` opens the "The host asks you to unmute" prompt while the microphone is off. The hint is
 *   unauthenticated, so it only ever shows a prompt; only the person's click unmutes.
 * - A server mute of a local track (LiveKit's remote-mute request, `EngineEvent.RemoteMute`) shows "The host muted your
 *   microphone" (camera, screen share) and is published as `serverMuted` so call-core's toggles follow.
 * - `ParticipantPermissionsChanged` of the local participant shows "The host turned off your microphone" / "You can
 *   unmute now" (and the camera and screen-share equivalents).
 * - Role changes of the local participant show a short notice.
 */
import { EngineEvent, RoomEvent, Track, type Participant } from 'livekit-client'
import { effectScope, watch } from 'vue'
import { toast } from 'vue-sonner'
import type { CallContext } from '../../../contracts/call'
import {
  muteCoveredByRevoke,
  permissionNotices,
  publishableSources,
  roleNotice,
  serverMuteMessage,
  serverMuteSource,
  type NoticeSource,
} from './notices'
import { hostActionsState } from './state'

const TERMINAL = new Set(['left', 'ended', 'removed', 'error'])

/** LiveKit's protobuf permission type (from @livekit/protocol, not a direct dependency). */
type ParticipantPermission = NonNullable<Participant['permissions']>

function notice(id: string, message: string) {
  toast.info(message, { id: `blinq-host-${id}`, position: 'top-center' })
}

function permissionLike(permission: ParticipantPermission | undefined) {
  if (!permission) return null
  return {
    canPublish: permission.canPublish,
    sources: permission.canPublishSources.map((source) => Track.sourceFromProto(source) as string),
  }
}

export function setupParticipantSide(ctx: CallContext): () => void {
  const state = hostActionsState(ctx)
  const cleanups: Array<() => void> = []
  const revokedAt = new Map<NoticeSource, number>()
  const engines = new WeakSet<object>()
  let seq = 0

  cleanups.push(
    ctx.events.on('server.hint', ({ type }) => {
      if (type !== 'ask-unmute' || ctx.phase.value !== 'inCall') return
      const self = ctx.self.value
      if (!self || self.micEnabled) return
      state.askUnmute.value = true
    }),
  )

  const room = ctx.room.value
  if (room) {
    const onPermissions = (previous: ParticipantPermission | undefined, participant: Participant) => {
      // The first permission set on join has no previous value: nothing changed for the person.
      if (!participant.isLocal || !previous) return
      const before = publishableSources(permissionLike(previous))
      const after = publishableSources(permissionLike(participant.permissions))
      for (const change of permissionNotices(before, after)) {
        if (change.change === 'revoked') revokedAt.set(change.source, Date.now())
        notice(change.source, change.message)
      }
    }
    room.on(RoomEvent.ParticipantPermissionsChanged, onPermissions)
    cleanups.push(() => room.off(RoomEvent.ParticipantPermissionsChanged, onPermissions))

    const onRemoteMute = (trackSid: string, muted: boolean) => {
      if (!muted) return
      const publication = room.localParticipant.trackPublications.get(trackSid)
      const source = publication ? serverMuteSource(publication.source) : null
      if (!source) return
      seq++
      state.serverMuted.value = { source, seq }
      if (!muteCoveredByRevoke(revokedAt.get(source), Date.now())) notice(source, serverMuteMessage(source))
    }
    // The engine is (re)created when the room connects, so attach once per engine when the call starts.
    const attachEngine = () => {
      const engine = room.engine
      if (!engine || engines.has(engine)) return
      engines.add(engine)
      engine.on(EngineEvent.RemoteMute, onRemoteMute)
      cleanups.push(() => engine.off(EngineEvent.RemoteMute, onRemoteMute))
    }
    cleanups.push(
      ctx.events.on('call.phase', (phase) => {
        if (phase === 'inCall' || phase === 'reconnecting') attachEngine()
        if (TERMINAL.has(phase)) state.askUnmute.value = false
      }),
    )
  }

  const scope = effectScope(true)
  scope.run(() => {
    watch(
      () => ctx.self.value?.role,
      (next, previous) => {
        if (next) state.role.value = next
        const message = roleNotice(previous, next)
        if (message) notice('role', message)
      },
    )
    // Unmuting some other way (button, hotkey) answers the prompt as well.
    watch(
      () => ctx.self.value?.micEnabled,
      (on) => {
        if (on) state.askUnmute.value = false
      },
    )
  })

  return () => {
    scope.stop()
    for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  }
}
