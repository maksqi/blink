/**
 * Host actions feature (Stage 06): per-participant moderation (the menu in the people panel and on tiles), the
 * participant side of moderation (ask-to-unmute prompt, mute and permission notices) and the removed/ended screens.
 *
 * `host-actions.notices` is a call view overlay: it renders only portaled dialogs and keeps the call view's UI state
 * at hand for toasts.
 */
import { defineCallFeature } from '../../../contracts/call'
import { lazyCallComponent } from '../../lazy'
import { setupParticipantSide } from './participant-side'

const EndNotice = lazyCallComponent(() => import('~/components/call/host/EndNotice.vue'))
const ParticipantNotices = lazyCallComponent(() => import('~/components/call/host/ParticipantNotices.vue'))
const TileActionsBadge = lazyCallComponent(() => import('~/components/call/host/TileActionsBadge.vue'))

export default defineCallFeature({
  id: 'host-actions',
  overlays: [{ id: 'host-actions.notices', order: 0, component: ParticipantNotices }],
  tileBadges: [{ id: 'host-actions.menu', order: 90, component: TileActionsBadge }],
  phaseScreens: [{ id: 'host-actions.end-notice', phases: ['removed', 'ended'], order: 10, component: EndNotice }],
  setup: (ctx) => setupParticipantSide(ctx),
})
