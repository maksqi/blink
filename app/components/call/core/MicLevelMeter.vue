<script setup lang="ts">
/** Live microphone level after the own-mic gain (so the gain slider visibly changes it). */
import { onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { cn } from '@/lib/utils'
import { useCallSession } from '~/composables/call'

const props = withDefaults(defineProps<{ bars?: number; class?: string }>(), { bars: 12, class: undefined })

const session = useCallSession()
const level = shallowRef(0)
let frame = 0

function tick() {
  const next = session.micLevel()
  // Fast attack, slow release, like a hardware meter.
  level.value = next > level.value ? next : level.value * 0.85 + next * 0.15
  frame = requestAnimationFrame(tick)
}

onMounted(() => {
  frame = requestAnimationFrame(tick)
})
onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <div
    role="meter"
    aria-label="Microphone level"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="Math.round(level * 100)"
    :data-level="Math.round(level * 100)"
    :class="cn('flex h-3 items-end gap-0.5', props.class)"
  >
    <span
      v-for="index in bars"
      :key="index"
      class="w-1 rounded-full transition-colors duration-75"
      :class="level * bars >= index - 0.5 ? (index > bars * 0.85 ? 'bg-amber-400' : 'bg-primary') : 'bg-white/15'"
      :style="{ height: `${40 + (index / bars) * 60}%` }"
    />
  </div>
</template>
