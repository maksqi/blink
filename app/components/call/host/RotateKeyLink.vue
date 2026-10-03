<script setup lang="ts">
/** Link to the room settings page (where the host rotates the room key), opened next to the call. */
import { ExternalLinkIcon } from '@lucide/vue'
import { computed } from 'vue'
import { roomSettingsPath } from '~/lib/call/features/host-actions/links'

const props = defineProps<{ roomId: string }>()
const href = computed(() => roomSettingsPath(props.roomId))
</script>

<template>
  <a
    :href="href"
    target="_blank"
    rel="noopener noreferrer"
    class="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
    data-testid="rotate-key-link"
  >
    Open room settings
    <ExternalLinkIcon class="size-3.5" aria-hidden="true" />
  </a>
</template>
