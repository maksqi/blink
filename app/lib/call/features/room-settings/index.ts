/**
 * Room settings feature (Stage 06): the host-controls button for hosts and co-hosts (lock, live settings, mute all,
 * end for all). Test builds also expose the room metadata every client sees as `window.__blinqTest.state.roomState`.
 */
import { defineCallFeature } from '../../../contracts/call'
import { testHooks } from '../../../contracts/test-hooks'
import { hasRoomControls } from './controls'
import HostControlsMenu from '~/components/call/host/HostControlsMenu.vue'

export default defineCallFeature({
  id: 'room-settings',
  controlBar: [
    {
      id: 'room-settings.host-controls',
      order: 900,
      placement: 'end',
      component: HostControlsMenu,
      visible: (ctx) => {
        const self = ctx.self.value
        return (
          (ctx.phase.value === 'inCall' || ctx.phase.value === 'reconnecting') &&
          hasRoomControls(self ? { identity: self.identity, role: self.role, kind: self.kind } : null)
        )
      },
    },
  ],
  setup(ctx) {
    if (!__BLINQ_TEST_HOOKS__) return undefined
    const hooks = testHooks()
    if (!hooks) return undefined
    const publish = () => {
      hooks.state.roomState = ctx.roomState.value ? { ...ctx.roomState.value } : null
    }
    publish()
    const off = ctx.events.on('room.state', (state) => {
      hooks.state.roomState = { ...state }
    })
    return () => {
      off()
      delete hooks.state.roomState
    }
  },
})
