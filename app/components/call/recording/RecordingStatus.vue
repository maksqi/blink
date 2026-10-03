<script setup lang="ts">
/**
 * The recorder's own upload status (only in the recorder's browser): where the recording goes, the upload backlog and
 * retries, "Uploading is falling behind" above 256 MiB, and the final upload after stopping.
 */
import { CloudAlertIcon, CloudUploadIcon, HardDriveIcon, LoaderCircleIcon } from '@lucide/vue'
import { computed } from 'vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useCall } from '~/composables/call'
import { recordingFor } from '~/lib/call/features/recording/state'

const ctx = useCall()
const controller = recordingFor(ctx)
const state = computed(() => controller?.state.value)

const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`
const parts = (count: number) => (count === 1 ? '1 part' : `${count} parts`)
const retriesText = (count: number) => (count === 1 ? '1 retry' : `${count} retries`)

const view = computed(() => {
  const s = state.value
  if (!s || s.phase === 'idle') return null
  if (s.mode === 'local') {
    return {
      icon: s.phase === 'recording' ? HardDriveIcon : LoaderCircleIcon,
      text: s.phase === 'recording' ? 'Saving to this device' : 'Saving the file',
      detail: 'The file stays on this device and is never uploaded.',
      tone: 'default' as const,
      spin: s.phase !== 'recording',
    }
  }
  const waiting =
    s.backlogChunks > 0
      ? `${parts(s.backlogChunks)} (${megabytes(s.backlogBytes)}) waiting to upload`
      : 'Everything recorded so far is uploaded'
  const retries = s.retries > 0 ? ` · ${retriesText(s.retries)}` : ''
  if (s.behind) {
    return {
      icon: CloudAlertIcon,
      text: 'Uploading is falling behind',
      detail: `${waiting}${retries}`,
      tone: 'warning' as const,
      spin: false,
    }
  }
  if (s.phase === 'stopping' || s.phase === 'finishing' || s.phase === 'starting') {
    return {
      icon: LoaderCircleIcon,
      text: s.phase === 'starting' ? 'Starting' : 'Finishing upload',
      detail: `${waiting}${retries}`,
      tone: 'default' as const,
      spin: true,
    }
  }
  return {
    icon: s.retries > 0 && s.backlogChunks > 1 ? CloudAlertIcon : CloudUploadIcon,
    text: s.backlogChunks > 1 ? 'Uploading' : 'Uploaded',
    detail: `${waiting}${retries}`,
    tone: s.retries > 0 && s.backlogChunks > 1 ? ('warning' as const) : ('default' as const),
    spin: false,
  }
})
</script>

<template>
  <Tooltip v-if="view" :delay-duration="200">
    <TooltipTrigger as-child>
      <button
        type="button"
        :class="
          cn(
            'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium ring-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            view.tone === 'warning'
              ? 'bg-amber-500/15 text-amber-200 ring-amber-400/30'
              : 'bg-white/8 text-white/80 ring-white/10',
          )
        "
        data-testid="recording-status"
        :data-behind="state?.behind ? 'true' : undefined"
        :aria-label="`${view.text}. ${view.detail}`"
      >
        <component :is="view.icon" :class="cn('size-4', view.spin && 'animate-spin')" aria-hidden="true" />
        <span class="hidden lg:inline">{{ view.text }}</span>
      </button>
    </TooltipTrigger>
    <TooltipContent side="top" :side-offset="8" class="max-w-72">
      <p class="font-medium">{{ view.text }}</p>
      <p>{{ view.detail }}</p>
    </TooltipContent>
  </Tooltip>
</template>
