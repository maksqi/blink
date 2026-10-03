/**
 * Lobby feature (Stage 06): the "Waiting room" side panel for hosts and co-hosts (admit, deny, admit all) with the
 * waiting count as its badge, and toasts for new arrivals.
 */
import { HourglassIcon } from '@lucide/vue'
import { effectScope, watch } from 'vue'
import { defineCallFeature } from '../../../contracts/call'
import { lobbyState } from './useLobby'
import LobbyPanel from '~/components/call/lobby/LobbyPanel.vue'

export default defineCallFeature({
  id: 'lobby',
  panels: [
    {
      id: 'lobby',
      title: 'Waiting room',
      icon: HourglassIcon,
      order: 20,
      component: LobbyPanel,
      visible: (ctx) => lobbyState(ctx).canView(),
      badge: (ctx) => lobbyState(ctx).entries.value.length || undefined,
    },
  ],
  setup(ctx) {
    const lobby = lobbyState(ctx)
    const offs = [
      ctx.events.on('server.hint', ({ type }) => {
        if (type === 'lobby.changed') lobby.refresh()
      }),
    ]
    // Fetch once the call starts (and when someone becomes a co-host); stop when they no longer may see it.
    const scope = effectScope(true)
    scope.run(() =>
      watch(
        () => (ctx.phase.value === 'inCall' || ctx.phase.value === 'reconnecting') && lobby.canView(),
        (active) => {
          if (active) lobby.refresh(0)
          else lobby.entries.value = []
        },
      ),
    )
    return () => {
      scope.stop()
      for (const off of offs) off()
      lobby.dispose()
    }
  },
})
