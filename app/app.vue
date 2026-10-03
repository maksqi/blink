<script setup lang="ts">
import 'vue-sonner/style.css'
import { Toaster } from '@/components/ui/sonner'

const colorMode = useColorMode()
const route = useRoute()
// vue-sonner styles itself from its `theme` prop, not from the html class.
const toastTheme = computed(() => (colorMode.value === 'dark' ? 'dark' : 'light'))
// The meeting page keeps its primary actions (Join, the control bar) along the bottom edge, so toasts go to the top
// there, including toasts started on the page before (app/lib/call/notify.ts uses the same spot).
const toastPosition = computed(() => (route.meta.layout === 'call' ? 'top-center' : 'bottom-right'))

useHead({
  titleTemplate: (title) => (title && title !== 'blinq' ? `${title} · blinq` : 'blinq'),
  // favicon.ico comes from nuxt.config; modern browsers prefer the SVG.
  link: [
    { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
  ],
  // Browser chrome on phones matches the page background (tailwind.css --background).
  meta: [
    { name: 'theme-color', media: '(prefers-color-scheme: light)', content: '#f7fbfc' },
    { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#0c1117' },
  ],
})
</script>

<template>
  <NuxtRouteAnnouncer />
  <NuxtLoadingIndicator color="var(--primary)" :height="2" :throttle="150" />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <Toaster :theme="toastTheme" :position="toastPosition" rich-colors close-button />
</template>
