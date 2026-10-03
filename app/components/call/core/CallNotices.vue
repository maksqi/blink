<script setup lang="ts">
/**
 * Call-level notices under the top bar: audio the browser refused to autoplay (needs one click), a microphone sent
 * without the mic chain because the browser's audio processing does not run, and unencrypted media that was blocked.
 */
import { MicIcon, ShieldAlertIcon, Volume2Icon } from '@lucide/vue'
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { useCallSession } from '~/composables/call'

const session = useCallSession()
const store = session.store

const blockedNames = computed(() =>
  store.blocked
    .map((identity) => store.participants.find((p) => p.identity === identity)?.name ?? 'Someone')
    .join(', '),
)
</script>

<template>
  <div class="pointer-events-none absolute inset-x-0 top-14 z-20 flex flex-col items-center gap-2 px-4">
    <div
      v-if="store.audioBlocked"
      class="pointer-events-auto flex items-center gap-3 rounded-xl bg-popover/95 px-4 py-2.5 text-sm text-popover-foreground shadow-lg ring-1 ring-white/10"
      role="alert"
    >
      <Volume2Icon class="size-4 text-primary" aria-hidden="true" />
      <span>Your browser paused the meeting audio.</span>
      <Button size="sm" @click="session.unlockAudio()">Play audio</Button>
    </div>
    <div
      v-if="store.micChainBypassed"
      data-testid="mic-chain-notice"
      class="pointer-events-auto flex max-w-xl items-start gap-3 rounded-xl bg-popover/95 px-4 py-2.5 text-sm text-popover-foreground shadow-lg ring-1 ring-white/10"
      role="status"
    >
      <MicIcon class="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      <span>
        Your browser's audio processing isn't running, so your microphone is sent without your volume and noise
        settings. Reload the page or use another browser to get them back.
      </span>
    </div>
    <div
      v-if="store.blocked.length > 0"
      data-testid="unencrypted-warning"
      class="pointer-events-auto flex max-w-xl items-start gap-3 rounded-xl bg-red-950/85 px-4 py-2.5 text-sm text-red-100 shadow-lg ring-1 ring-red-400/30"
      role="alert"
    >
      <ShieldAlertIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        Unencrypted media from {{ blockedNames }} was blocked. You can't see or hear it. They may be using an outdated
        or modified app.
      </span>
    </div>
  </div>
</template>
