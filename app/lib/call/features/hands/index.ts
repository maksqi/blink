/**
 * Hands feature (Stage 06): the raise-hand button for everyone and, for moderators, a toast when someone raises their
 * hand (at most one per 5 s, summarized beyond that). The queue itself is shown in the people panel.
 */
import { effectScope, watch } from 'vue'
import { toast } from 'vue-sonner'
import { defineCallFeature } from '../../../contracts/call'
import { openCallPanel } from '../host-actions/state'
import { isModeratorRole } from '../participants/useParticipantInfo'
import { HandNotifier, handSnapshot, newlyRaised } from './queue'
import RaiseHandButton from '~/components/call/participants/RaiseHandButton.vue'

export default defineCallFeature({
  id: 'hands',
  controlBar: [
    {
      id: 'hands.raise',
      order: 40,
      placement: 'center',
      component: RaiseHandButton,
      visible: (ctx) => ctx.phase.value === 'inCall' || ctx.phase.value === 'reconnecting',
    },
  ],
  setup(ctx) {
    const notifier = new HandNotifier({
      show: (message) =>
        toast.info(message, {
          id: 'blinq-hand-raised',
          position: 'top-center',
          action: { label: 'View', onClick: () => openCallPanel(ctx, 'participants') },
        }),
    })
    let previous: Map<string, number | null> | null = null
    const scope = effectScope(true)
    scope.run(() =>
      watch(
        () => ctx.participants.value,
        (participants) => {
          if (ctx.phase.value !== 'inCall' || !ctx.self.value) {
            previous = null
            return
          }
          // The first snapshot in the call is history (hands raised before we joined): no toast for those.
          if (previous && isModeratorRole(ctx.self.value.role)) {
            notifier.raised(newlyRaised(previous, participants).map((p) => p.name))
          }
          previous = handSnapshot(participants)
        },
      ),
    )
    return () => {
      scope.stop()
      notifier.dispose()
    }
  },
})
