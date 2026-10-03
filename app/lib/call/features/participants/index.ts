/**
 * Participants feature (Stage 06): the "People" side panel (roles, media state, search, the hand queue, rename and
 * the moderation menu) and the role badges on tiles. It also keeps the moderators' allowance list fresh.
 */
import { UsersIcon } from '@lucide/vue'
import { effectScope, watch } from 'vue'
import { defineCallFeature } from '../../../contracts/call'
import { lazyCallComponent } from '../../lazy'
import { isModeratorRole, participantInfoStore } from './useParticipantInfo'

const ParticipantsPanel = lazyCallComponent(() => import('~/components/call/participants/ParticipantsPanel.vue'))
const RoleBadge = lazyCallComponent(() => import('~/components/call/participants/RoleBadge.vue'))

export default defineCallFeature({
  id: 'participants',
  panels: [
    {
      id: 'participants',
      title: 'People',
      icon: UsersIcon,
      order: 10,
      component: ParticipantsPanel,
      badge: (ctx) => ctx.participants.value.length || undefined,
    },
  ],
  tileBadges: [{ id: 'participants.role', order: 10, component: RoleBadge }],
  setup(ctx) {
    const info = participantInfoStore(ctx)
    const offs = [
      ctx.events.on('server.hint', ({ type }) => {
        if (type === 'participant.changed') info.refresh()
      }),
      ctx.events.on('participant.joined', () => info.refresh()),
      ctx.events.on('participant.left', () => info.refresh()),
      ctx.events.on('call.phase', (phase) => {
        if (phase === 'inCall') info.refresh(0)
      }),
    ]
    // Someone promoted to co-host needs the list right away.
    const scope = effectScope(true)
    scope.run(() =>
      watch(
        () => isModeratorRole(ctx.self.value?.role),
        (moderator) => {
          if (moderator) info.refresh(0)
        },
      ),
    )
    return () => {
      scope.stop()
      for (const off of offs) off()
      info.dispose()
    }
  },
})
