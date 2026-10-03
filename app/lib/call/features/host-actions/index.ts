/**
 * Host actions feature (Stage 06): per-participant moderation (the menu in the people panel and on tiles), the
 * participant side of moderation (ask-to-unmute prompt, mute and permission notices) and the removed/ended screens.
 *
 * `host-actions.notices` is a zero-footprint control-bar item: it renders only portaled dialogs and keeps the call
 * view's UI state at hand for toasts (decision: the registries have no other always-mounted slot).
 */
import { defineCallFeature } from '../../../contracts/call'
import { setupParticipantSide } from './participant-side'
import EndNotice from '~/components/call/host/EndNotice.vue'
import ParticipantNotices from '~/components/call/host/ParticipantNotices.vue'
import TileActionsBadge from '~/components/call/host/TileActionsBadge.vue'

export default defineCallFeature({
  id: 'host-actions',
  controlBar: [{ id: 'host-actions.notices', order: 0, placement: 'start', component: ParticipantNotices }],
  tileBadges: [{ id: 'host-actions.menu', order: 90, component: TileActionsBadge }],
  phaseScreens: [{ id: 'host-actions.end-notice', phases: ['removed', 'ended'], order: 10, component: EndNotice }],
  setup: (ctx) => setupParticipantSide(ctx),
})
