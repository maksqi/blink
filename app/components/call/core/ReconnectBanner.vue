<script setup lang="ts">
/**
 * Shown on `Reconnecting` / `SignalReconnecting`; after `Reconnected` it says so briefly, then hides. The media keeps
 * its keys: a reconnect never downgrades encryption.
 */
import { LoaderCircleIcon, WifiIcon } from '@lucide/vue'
import { onBeforeUnmount, shallowRef, watch } from 'vue'
import { useCallSession } from '~/composables/call'

const session = useCallSession()
const store = session.store

const state = shallowRef<'hidden' | 'reconnecting' | 'reconnected'>('hidden')
let timer: ReturnType<typeof setTimeout> | null = null

watch(
  () => store.phase,
  (phase, previous) => {
    if (timer) clearTimeout(timer)
    timer = null
    if (phase === 'reconnecting') {
      state.value = 'reconnecting'
    } else if (previous === 'reconnecting' && phase === 'inCall') {
      state.value = 'reconnected'
      timer = setTimeout(() => (state.value = 'hidden'), 2500)
    } else {
      state.value = 'hidden'
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div aria-live="polite" class="pointer-events-none absolute inset-x-0 top-2 z-30 flex justify-center px-4">
    <div
      v-if="state !== 'hidden'"
      data-testid="reconnect-banner"
      :data-state="state"
      role="status"
      class="pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium shadow-lg ring-1 backdrop-blur"
      :class="
        state === 'reconnecting'
          ? 'bg-amber-500/20 text-amber-100 ring-amber-400/40'
          : 'bg-emerald-500/20 text-emerald-100 ring-emerald-400/40'
      "
    >
      <LoaderCircleIcon v-if="state === 'reconnecting'" class="size-4 motion-safe:animate-spin" aria-hidden="true" />
      <WifiIcon v-else class="size-4" aria-hidden="true" />
      {{ state === 'reconnecting' ? 'Connection lost. Reconnecting…' : 'Reconnected' }}
    </div>
  </div>
</template>
