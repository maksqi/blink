<script setup lang="ts">
/** Status of a recording as badges: Recording, Processing, Ready or Failed, plus Partial and On device. */
import { AlertTriangleIcon, CircleIcon, HardDriveIcon, LoaderCircleIcon } from '@lucide/vue'
import type { RecordingSummary } from '#shared/schemas/recordings'
import { Badge } from '@/components/ui/badge'

const props = defineProps<{ recording: Pick<RecordingSummary, 'status' | 'partial' | 'mode'> }>()

const label = computed(() => {
  switch (props.recording.status) {
    case 'recording':
      return 'Recording'
    case 'processing':
      return 'Processing'
    case 'ready':
      return 'Ready'
    default:
      return 'Failed'
  }
})
</script>

<template>
  <span class="inline-flex flex-wrap items-center gap-1.5">
    <Badge v-if="recording.status === 'recording'" variant="destructive" data-testid="recording-status">
      <CircleIcon data-icon="inline-start" class="fill-current" aria-hidden="true" />
      {{ label }}
    </Badge>
    <Badge v-else-if="recording.status === 'processing'" variant="secondary" data-testid="recording-status">
      <LoaderCircleIcon data-icon="inline-start" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
      {{ label }}
    </Badge>
    <Badge v-else-if="recording.status === 'failed'" variant="destructive" data-testid="recording-status">
      <AlertTriangleIcon data-icon="inline-start" aria-hidden="true" />
      {{ label }}
    </Badge>
    <Badge v-else variant="outline" data-testid="recording-status">{{ label }}</Badge>
    <Badge v-if="recording.partial" variant="outline" class="border-amber-500/40 text-amber-700 dark:text-amber-400">
      Partial
    </Badge>
    <Badge v-if="recording.mode === 'local'" variant="ghost" class="text-muted-foreground">
      <HardDriveIcon data-icon="inline-start" aria-hidden="true" />
      On device
    </Badge>
  </span>
</template>
