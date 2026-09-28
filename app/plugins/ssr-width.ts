import { provideSSRWidth } from '@vueuse/core'

/**
 * VueUse media queries (`useMediaQuery`, `useBreakpoints`, the shadcn Sidebar) assume this width during SSR and
 * hydration, so both sides render the same markup; real media queries take over after mount. 1024 px renders the
 * tablet/desktop shell (decision). Universal on purpose: the client must hydrate with the same width.
 */
export default defineNuxtPlugin({
  name: 'blinq:ssr-width',
  setup(nuxtApp) {
    provideSSRWidth(1024, nuxtApp.vueApp)
  },
})
