<script setup lang="ts">
/**
 * End screen for `removed` and `ended` (a `phaseScreens` entry above the core end screen). A host who removed someone
 * during the call also gets the key-rotation follow-up here.
 */
import { DoorOpenIcon, KeyRoundIcon, UserXIcon } from '@lucide/vue'
import { computed } from 'vue'
import RotateKeyLink from './RotateKeyLink.vue'
import { Button } from '@/components/ui/button'
import { useCall } from '~/composables/call'
import { HOST_ROTATE_TEXT } from '~/lib/call/features/host-actions/removal'
import { hostActionsState } from '~/lib/call/features/host-actions/state'

const ctx = useCall()
const state = hostActionsState(ctx)

const removed = computed(() => ctx.phase.value === 'removed')
const view = computed(() =>
  removed.value
    ? {
        icon: UserXIcon,
        title: 'Removed from the meeting',
        text: 'You were removed from this meeting. You cannot rejoin it.',
      }
    : { icon: DoorOpenIcon, title: 'The meeting has ended', text: 'The host ended the meeting for everyone.' },
)
const rotateFollowUp = computed(
  () => !removed.value && state.role.value === 'host' && state.removedCount.value > 0 && Boolean(ctx.roomId.value),
)
</script>

<template>
  <div
    class="flex min-h-full flex-1 items-center justify-center p-6"
    data-testid="call-end-notice"
    :data-phase="ctx.phase.value"
  >
    <div class="flex max-w-sm flex-col items-center text-center">
      <span class="flex size-14 items-center justify-center rounded-2xl bg-white/8 text-white/90 ring-1 ring-white/10">
        <component :is="view.icon" class="size-7" aria-hidden="true" />
      </span>
      <h1 class="mt-5 text-xl font-semibold tracking-tight">{{ view.title }}</h1>
      <p class="mt-2 text-sm text-muted-foreground" data-testid="call-end-notice-text">{{ view.text }}</p>
      <div
        v-if="rotateFollowUp"
        class="mt-5 flex items-start gap-3 rounded-xl bg-amber-950/50 p-4 text-left text-sm text-amber-100 ring-1 ring-amber-400/25"
        data-testid="rotate-key-reminder"
      >
        <KeyRoundIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div class="flex flex-col gap-2">
          <p>{{ HOST_ROTATE_TEXT }}</p>
          <RotateKeyLink :room-id="ctx.roomId.value!" />
        </div>
      </div>
      <div class="mt-6 flex flex-wrap justify-center gap-2">
        <Button variant="secondary" as-child>
          <a href="/">Back to home</a>
        </Button>
      </div>
    </div>
  </div>
</template>
