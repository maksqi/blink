<script setup lang="ts">
import { SignalHighIcon, SignalLowIcon, SignalMediumIcon, WifiOffIcon } from '@lucide/vue'
import { computed } from 'vue'
import { cn } from '@/lib/utils'
import type { ConnectionQualityLevel } from '~/lib/contracts/call'

const props = defineProps<{ quality: ConnectionQualityLevel; class?: string }>()

const view = computed(() => {
  switch (props.quality) {
    case 'excellent':
      return { icon: SignalHighIcon, label: 'Connection: excellent', tone: 'text-white/80' }
    case 'good':
      return { icon: SignalMediumIcon, label: 'Connection: good', tone: 'text-white/80' }
    case 'poor':
      return { icon: SignalLowIcon, label: 'Connection: poor', tone: 'text-amber-300' }
    case 'lost':
      return { icon: WifiOffIcon, label: 'Connection lost', tone: 'text-red-300' }
    default:
      return null
  }
})
</script>

<template>
  <span
    v-if="view"
    role="img"
    :aria-label="view.label"
    :title="view.label"
    :data-quality="quality"
    :class="cn('inline-flex size-6 items-center justify-center rounded-md bg-black/45', view.tone, props.class)"
  >
    <component :is="view.icon" class="size-3.5" aria-hidden="true" />
  </span>
</template>
