<script setup lang="ts">
/**
 * Raised hands in raise order. Moderators get "Allow to speak" (give the microphone, lower the hand, ask to unmute;
 * the person still decides) and "Lower hand"; everyone sees their own position.
 */
import { HandIcon } from '@lucide/vue'
import { computed, shallowRef } from 'vue'
import { Button } from '@/components/ui/button'
import { canPerform } from '#shared/utils/permissions'
import { useCall } from '~/composables/call'
import type { QueueEntry } from '~/lib/call/features/hands/queue'
import { callActions } from '~/lib/call/features/host-actions/state'
import type { ParticipantView } from '~/lib/contracts/call'

const props = defineProps<{ entries: QueueEntry<ParticipantView>[] }>()

const ctx = useCall()
const actions = callActions(ctx)
const busy = shallowRef<string | null>(null)

const actor = computed(() => {
  const self = ctx.self.value
  return self ? { identity: self.identity, role: self.role, kind: self.kind } : null
})
const ownPosition = computed(() => props.entries.find((entry) => entry.participant.isLocal)?.position ?? null)

function can(action: 'participant.lowerHand' | 'participant.permissions', participant: ParticipantView): boolean {
  return actor.value ? canPerform(actor.value, action, participant) : false
}

async function act(participant: ParticipantView, kind: 'allow' | 'lower') {
  busy.value = participant.identity
  const target = { identity: participant.identity, name: participant.name }
  try {
    if (kind === 'allow') await actions.allowToSpeak(target)
    else await actions.lowerHand(target)
  } finally {
    busy.value = null
  }
}

async function lowerOwn() {
  busy.value = ctx.self.value?.identity ?? null
  try {
    await actions.setHand(false)
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <section aria-labelledby="hand-queue-title" class="flex flex-col gap-1" data-testid="hand-queue">
    <h3 id="hand-queue-title" class="flex items-center gap-2 px-2 text-xs font-semibold text-muted-foreground">
      <HandIcon class="size-3.5 text-amber-300" aria-hidden="true" />
      Raised hands ({{ entries.length }})
    </h3>
    <p v-if="ownPosition" class="px-2 text-xs text-amber-200" data-testid="own-hand-position">
      Your hand is up. You are number {{ ownPosition }} in line.
    </p>
    <ol class="flex flex-col gap-1">
      <li
        v-for="entry in entries"
        :key="entry.participant.identity"
        class="flex min-h-11 flex-wrap items-center gap-2 rounded-lg bg-amber-400/8 px-2 py-1.5"
        data-testid="hand-queue-entry"
        :data-identity="entry.participant.identity"
        :data-position="entry.position"
      >
        <span
          class="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-amber-950 tabular-nums"
          aria-hidden="true"
          >{{ entry.position }}</span
        >
        <span class="min-w-0 flex-1 truncate text-sm">
          <span class="sr-only">Number {{ entry.position }}: </span>
          {{ entry.participant.isLocal ? `${entry.participant.name} (you)` : entry.participant.name }}
        </span>
        <div class="flex shrink-0 items-center gap-1">
          <Button
            v-if="can('participant.permissions', entry.participant)"
            size="sm"
            variant="secondary"
            :disabled="busy === entry.participant.identity"
            data-testid="hand-allow"
            @click="act(entry.participant, 'allow')"
            >Allow to speak</Button
          >
          <Button
            v-if="can('participant.lowerHand', entry.participant)"
            size="sm"
            variant="ghost"
            :disabled="busy === entry.participant.identity"
            data-testid="hand-lower"
            @click="act(entry.participant, 'lower')"
            >Lower hand</Button
          >
          <Button
            v-else-if="entry.participant.isLocal"
            size="sm"
            variant="ghost"
            :disabled="busy === entry.participant.identity"
            data-testid="hand-lower-own"
            @click="lowerOwn"
            >Lower hand</Button
          >
        </div>
      </li>
    </ol>
  </section>
</template>
