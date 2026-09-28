<script setup lang="ts">
/**
 * Default screen for terminal phases (left, ended, removed, error). Features can replace it with a higher-order
 * `phaseScreens` entry (for example host follow-ups after a removal).
 */
import { CircleAlertIcon, DoorOpenIcon, LogOutIcon, UserXIcon } from '@lucide/vue'
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { useCall, useCallSession, useCallUi } from '~/composables/call'

const ctx = useCall()
const session = useCallSession()
const ui = useCallUi()

const view = computed(() => {
  switch (ctx.phase.value) {
    case 'ended':
      return { icon: DoorOpenIcon, title: 'The meeting has ended', text: 'The host ended the meeting for everyone.' }
    case 'removed':
      return { icon: UserXIcon, title: 'You were removed from the meeting', text: 'A host removed you. You cannot rejoin this meeting.' }
    case 'error':
      return {
        icon: CircleAlertIcon,
        title: "You're not connected",
        text: session.store.error?.message ?? 'Something went wrong with the connection.',
      }
    default:
      return { icon: LogOutIcon, title: 'You left the meeting', text: 'Your camera and microphone are off.' }
  }
})
const canRejoin = computed(() => ctx.phase.value !== 'removed' && ctx.phase.value !== 'ended' && Boolean(ui.rejoin.value))
</script>

<template>
  <div class="flex min-h-full flex-1 items-center justify-center p-6" data-testid="call-end-screen" :data-phase="ctx.phase.value">
    <div class="flex max-w-sm flex-col items-center text-center">
      <span class="flex size-14 items-center justify-center rounded-2xl bg-white/8 text-white/90 ring-1 ring-white/10">
        <component :is="view.icon" class="size-7" aria-hidden="true" />
      </span>
      <h1 class="mt-5 text-xl font-semibold tracking-tight">{{ view.title }}</h1>
      <p class="mt-2 text-sm text-muted-foreground">{{ view.text }}</p>
      <div class="mt-6 flex flex-wrap justify-center gap-2">
        <Button v-if="canRejoin" @click="ui.rejoin.value?.()">Rejoin</Button>
        <Button variant="secondary" as-child>
          <a href="/">Back to home</a>
        </Button>
      </div>
    </div>
  </div>
</template>
