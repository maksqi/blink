<script setup lang="ts">
/**
 * REC indicator for everyone, driven by the server-written room metadata (`roomState.recording`): a red dot, "REC"
 * and the time since the recording started. The tooltip says where the recording goes (server recordings are readable
 * by the server and its admins). Starts and stops are announced to screen readers (the toast comes from the feature).
 */
import { useIntervalFn } from '@vueuse/core'
import { computed, shallowRef, watch } from 'vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCall } from '~/composables/call'
import { formatElapsed, indicatorDisclosure, recordingAnnouncement } from '~/lib/recording/announce'

const ctx = useCall()
const recording = computed(() => ctx.roomState.value?.recording ?? null)

const now = shallowRef(Date.now())
const { pause, resume } = useIntervalFn(() => (now.value = Date.now()), 1000, { immediate: false })
const elapsed = computed(() => {
  const startedAt = recording.value ? Date.parse(recording.value.startedAt) : Number.NaN
  return Number.isNaN(startedAt) ? '' : formatElapsed(now.value - startedAt)
})

const announcement = shallowRef('')
watch(
  recording,
  (next, previous) => {
    now.value = Date.now()
    if (next) resume()
    else pause()
    const text = recordingAnnouncement(previous, next, { initial: previous === undefined, own: false })
    // The initial state of a late joiner is announced too; a quiet first render stays quiet.
    if (text) announcement.value = text
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex min-w-0 items-center">
    <span class="sr-only" aria-live="polite" data-testid="recording-announcement">{{ announcement }}</span>
    <Tooltip v-if="recording" :delay-duration="200">
      <TooltipTrigger as-child>
        <button
          type="button"
          class="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-red-500/15 px-3 text-sm font-semibold text-red-200 ring-1 ring-red-400/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          data-testid="recording-indicator"
          :data-mode="recording.mode"
          :aria-label="`Recording by ${recording.by}, ${elapsed}`"
        >
          <span class="relative flex size-2.5" aria-hidden="true">
            <span
              class="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60 motion-reduce:hidden"
            />
            <span class="relative inline-flex size-2.5 rounded-full bg-red-500" />
          </span>
          <span>REC</span>
          <span class="font-normal tabular-nums text-red-100/80">{{ elapsed }}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" :side-offset="8" class="max-w-72" data-testid="recording-disclosure">
        <p class="font-medium">Recording by {{ recording.by }}</p>
        <p>{{ indicatorDisclosure(recording) }}</p>
      </TooltipContent>
    </Tooltip>
  </div>
</template>
