/**
 * Core call controls, registered like any other feature: mic, camera, screen share, invite, leave, the overflow
 * entries (layout, settings, shortcuts), the device and audio settings sections and the default end screen.
 */
import { defineComponent, h, markRaw } from 'vue'
import { defineCallFeature } from '../../../contracts/call'
import { lazyCallComponent } from '../../lazy'
import CameraControl from '~/components/call/core/CameraControl.vue'
import LeaveButton from '~/components/call/core/LeaveButton.vue'
import MicControl from '~/components/call/core/MicControl.vue'
import ScreenShareButton from '~/components/call/core/ScreenShareButton.vue'

const AudioSettings = lazyCallComponent(() => import('~/components/call/core/AudioSettings.vue'))
const CallEndScreen = lazyCallComponent(() => import('~/components/call/core/CallEndScreen.vue'))
const DeviceSettings = lazyCallComponent(() => import('~/components/call/core/DeviceSettings.vue'))
const InviteButton = lazyCallComponent(() => import('~/components/call/core/InviteButton.vue'))
const LayoutMenuItem = lazyCallComponent(() => import('~/components/call/core/LayoutMenuItem.vue'))

const menuEntry = (entry: 'layout' | 'settings' | 'hotkeys') =>
  markRaw(defineComponent({ name: `CoreMenu-${entry}`, setup: () => () => h(LayoutMenuItem, { entry }) }))

export default defineCallFeature({
  id: 'core',
  controlBar: [
    { id: 'core.mic', order: 10, placement: 'center', component: MicControl },
    { id: 'core.camera', order: 20, placement: 'center', component: CameraControl },
    { id: 'core.screen-share', order: 30, placement: 'center', component: ScreenShareButton },
    {
      id: 'core.invite',
      order: 10,
      placement: 'end',
      component: InviteButton,
      visible: (ctx) => ctx.self.value?.role === 'host' || ctx.self.value?.role === 'cohost',
    },
    { id: 'core.layout', order: 10, placement: 'overflow', component: menuEntry('layout') },
    { id: 'core.settings', order: 90, placement: 'overflow', component: menuEntry('settings') },
    { id: 'core.hotkeys', order: 95, placement: 'overflow', component: menuEntry('hotkeys') },
    { id: 'core.leave', order: 1000, placement: 'end', component: LeaveButton },
  ],
  settings: [
    { id: 'core.devices', title: 'Devices', order: 10, component: DeviceSettings },
    { id: 'core.audio', title: 'Audio', order: 20, component: AudioSettings },
  ],
  phaseScreens: [{ id: 'core.end', phases: ['left', 'ended', 'removed', 'error'], order: 0, component: CallEndScreen }],
})
