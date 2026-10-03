/**
 * Reactions feature (Stage 06): the reactions popover in the control bar (it also mounts the floating overlay) and the
 * sender's latest reaction on their tile. Reactions are end-to-end encrypted app messages.
 */
import { defineCallFeature } from '../../../contracts/call'
import { reactionsState } from './useReactions'
import ReactionsButton from '~/components/call/reactions/ReactionsButton.vue'
import ReactionTileBadge from '~/components/call/reactions/ReactionTileBadge.vue'

export default defineCallFeature({
  id: 'reactions',
  controlBar: [
    {
      id: 'reactions.picker',
      order: 50,
      placement: 'center',
      component: ReactionsButton,
      visible: (ctx) => ctx.phase.value === 'inCall' || ctx.phase.value === 'reconnecting',
    },
  ],
  tileBadges: [{ id: 'reactions.latest', order: 20, component: ReactionTileBadge }],
  setup(ctx) {
    const reactions = reactionsState(ctx)
    return () => reactions.dispose()
  },
})
