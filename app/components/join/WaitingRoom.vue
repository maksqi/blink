<script setup lang="ts">
/**
 * Waiting room (join phase `waiting`): the person's own preview, a calm "waiting" message and Cancel. The page listens
 * to the waiting-room events and connects as soon as a host lets the person in.
 */
import { HourglassIcon, VideoOffIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import VideoTrackView from '~/components/call/core/VideoTrackView.vue'
import type { CallSession } from '~/lib/call/session'
import JoinScreen from './JoinScreen.vue'

const props = defineProps<{ session: CallSession | null; meeting?: string; cancelling?: boolean }>()
const emit = defineEmits<{ cancel: [] }>()

const preview = computed(() => props.session?.previewTrack() ?? null)
</script>

<template>
  <JoinScreen
    :icon="HourglassIcon"
    :meeting="meeting"
    title="Waiting for the host to let you in"
    description="You'll join automatically as soon as a host lets you in. Keep this tab open."
    data-testid="waiting-room"
  >
    <template #media>
      <div
        class="relative aspect-video w-full max-w-xs overflow-hidden rounded-2xl bg-card shadow-2xl shadow-black/30 ring-1 ring-white/8"
      >
        <VideoTrackView v-if="preview" :track="preview" mirror class="absolute inset-0" />
        <div v-else class="absolute inset-0 flex items-center justify-center text-white/50">
          <VideoOffIcon class="size-7" aria-hidden="true" />
        </div>
        <span
          class="absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white/90"
        >
          <Spinner class="size-3" />
          Waiting
        </span>
      </div>
    </template>
    <Button variant="secondary" :disabled="cancelling" data-testid="waiting-cancel" @click="emit('cancel')">
      <Spinner v-if="cancelling" />
      Leave the waiting room
    </Button>
  </JoinScreen>
</template>
