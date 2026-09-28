<script setup lang="ts">
/** Settings section "Audio": own microphone gain (0–200 %), applied in the mic chain without republishing. */
import { computed } from 'vue'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Slider } from '@/components/ui/slider'
import MicLevelMeter from './MicLevelMeter.vue'
import { useCall, useCallSession } from '~/composables/call'

const ctx = useCall()
const session = useCallSession()

const percent = computed(() => Math.round(session.store.micGain * 100))

function setGain(value: number[] | undefined) {
  const next = value?.[0]
  if (typeof next === 'number') ctx.audio.setMicGain(next / 100)
}
</script>

<template>
  <Field>
    <div class="flex items-center justify-between">
      <FieldLabel for="mic-gain">Microphone volume</FieldLabel>
      <span class="text-sm text-muted-foreground tabular-nums">{{ percent }}%</span>
    </div>
    <Slider
      id="mic-gain"
      :model-value="[percent]"
      :min="0"
      :max="200"
      :step="5"
      aria-label="Microphone volume"
      @update:model-value="setGain"
    />
    <MicLevelMeter class="mt-1" :bars="24" />
    <FieldDescription>How loud others hear you. 100% leaves your microphone unchanged.</FieldDescription>
  </Field>
</template>
