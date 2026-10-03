<script setup lang="ts">
/**
 * Record / stop (hosts and co-hosts with an account, when the server allows recording). While this browser records it
 * shows the elapsed time; the controller warns 5 minutes before the time limit and stops at the limit. While someone
 * else records, it stops their recording (any moderator with an account may).
 */
import { CircleIcon, SquareIcon } from '@lucide/vue'
import { useIntervalFn } from '@vueuse/core'
import { computed, shallowRef, watch } from 'vue'
import StartRecordingDialog from './StartRecordingDialog.vue'
import CallControlButton from '~/components/call/core/CallControlButton.vue'
import { useCall } from '~/composables/call'
import { recordingFor } from '~/lib/call/features/recording/state'
import { formatElapsed } from '~/lib/recording/announce'
import type { RecordingMode } from '~/lib/recording/controller'

const ctx = useCall()
const controller = recordingFor(ctx)
const dialogOpen = shallowRef(false)
const stoppingOthers = shallowRef(false)

const state = computed(() => controller?.state.value)
const phase = computed(() => state.value?.phase ?? 'idle')
const own = computed(() => phase.value !== 'idle')
const others = computed(() => !own.value && Boolean(ctx.roomState.value?.recording))

const now = shallowRef(Date.now())
const { pause, resume } = useIntervalFn(() => (now.value = Date.now()), 1000, { immediate: false })
watch(
  phase,
  (value) => {
    now.value = Date.now()
    if (value === 'recording') resume()
    else pause()
  },
  { immediate: true },
)
const elapsed = computed(() => {
  const startedAt = state.value?.startedAt
  if (phase.value !== 'recording' || !startedAt) return undefined
  return formatElapsed(now.value - startedAt)
})
const nearLimit = computed(() => {
  const s = state.value
  if (!s?.startedAt || !s.maxDurationMs || phase.value !== 'recording') return false
  return now.value - s.startedAt >= s.maxDurationMs - 5 * 60_000
})

const label = computed(() => {
  switch (phase.value) {
    case 'starting':
      return 'Starting the recording'
    case 'recording':
      return elapsed.value ? `Stop recording (${elapsed.value})` : 'Stop recording'
    case 'stopping':
    case 'finishing':
      return 'Finishing the recording'
    default:
      return others.value ? 'Stop the recording' : 'Record'
  }
})
const busy = computed(() => phase.value === 'starting' || phase.value === 'stopping' || phase.value === 'finishing')

function onStart(mode: RecordingMode) {
  // Synchronous up to the first await inside start(): the AudioContext is created within this click.
  void controller?.start(mode)
}

async function onClick() {
  if (!controller || busy.value) return
  if (phase.value === 'recording') {
    await controller.stop('user')
    return
  }
  if (others.value) {
    stoppingOthers.value = true
    await controller.stopOthers()
    stoppingOthers.value = false
    return
  }
  dialogOpen.value = true
}
</script>

<template>
  <CallControlButton
    :label="label"
    :icon="own || others ? SquareIcon : CircleIcon"
    :pressed="own"
    :tone="own ? (nearLimit ? 'danger' : 'off') : 'default'"
    :disabled="busy || stoppingOthers"
    :disabled-reason="label"
    :text="elapsed"
    data-control="record"
    data-testid="record-button"
    :data-state="phase"
    @click="onClick"
  />
  <StartRecordingDialog v-model:open="dialogOpen" @start="onStart" />
</template>
