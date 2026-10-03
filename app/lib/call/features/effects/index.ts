/**
 * Video and audio effects (Stage 07, media-fx): background blur, noise suppression (off, browser, RNNoise) and own mic
 * gain, in pre-join and during the call, remembered per device. Switching never republishes a track.
 */
import { defineCallFeature } from '../../../contracts/call'
import { browserStorage, readDevicePrefs } from '../../devices'
import { currentMediaFxEnv } from '../../../media/support'
import { EffectsController, registerEffects } from './controller'
import BlurToggle from '~/components/call/effects/BlurToggle.vue'
import EffectsSettings from '~/components/call/effects/EffectsSettings.vue'
import PreJoinEffects from '~/components/call/effects/PreJoinEffects.vue'
import { useCallStore } from '~/stores/call'

export default defineCallFeature({
  id: 'effects',
  preJoin: [{ id: 'effects.prejoin', order: 10, component: PreJoinEffects }],
  settings: [{ id: 'effects.settings', title: 'Video and audio effects', order: 30, component: EffectsSettings }],
  controlBar: [{ id: 'effects.blur', order: 50, placement: 'overflow', component: BlurToggle }],
  setup(ctx) {
    if (typeof window === 'undefined') return undefined
    const storage = browserStorage()
    const controller = new EffectsController({
      ctx,
      store: useCallStore(),
      env: currentMediaFxEnv(),
      storage,
      // call-core opens these devices first; their saved effects apply before the tracks start.
      expectedDevices: readDevicePrefs(storage),
    })
    const unregister = registerEffects(ctx, controller)
    controller.start()
    return () => {
      unregister()
      controller.dispose()
    }
  },
})
