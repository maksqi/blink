<script setup lang="ts">
/**
 * Reactions control: a popover with the six reactions (sent end-to-end encrypted, at most 3 per second). It also mounts
 * the reactions overlay, teleported to <body> so it floats above the whole call.
 */
import { SmilePlusIcon } from '@lucide/vue'
import { shallowRef } from 'vue'
import ReactionsOverlay from './ReactionsOverlay.vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useCall } from '~/composables/call'
import { REACTION_EMOJI, REACTION_LABEL, REACTION_LIST, type Reaction } from '~/lib/call/features/reactions/feed'
import { reactionsState } from '~/lib/call/features/reactions/useReactions'

const ctx = useCall()
const reactions = reactionsState(ctx)
const open = shallowRef(false)
const limited = shallowRef(false)
let limitTimer: ReturnType<typeof setTimeout> | null = null

async function react(reaction: Reaction) {
  const sent = await reactions.send(reaction)
  if (!sent && !reactions.canSend()) {
    limited.value = true
    if (limitTimer) clearTimeout(limitTimer)
    limitTimer = setTimeout(() => (limited.value = false), 1_000)
  }
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        aria-label="Reactions"
        title="Reactions"
        data-control="reactions"
        :class="
          cn(
            'inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full px-3 text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            open ? 'bg-primary/25 text-primary hover:bg-primary/30' : 'bg-white/10 hover:bg-white/18',
          )
        "
      >
        <SmilePlusIcon class="size-5" aria-hidden="true" />
      </button>
    </PopoverTrigger>
    <PopoverContent side="top" :side-offset="10" :collision-padding="12" class="w-auto p-1.5" data-testid="reactions-menu">
      <div class="flex items-center gap-1" role="group" aria-label="Send a reaction">
        <button
          v-for="reaction in REACTION_LIST"
          :key="reaction"
          type="button"
          class="inline-flex size-11 items-center justify-center rounded-lg text-2xl transition-transform hover:scale-110 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 motion-reduce:hover:scale-100"
          :aria-label="REACTION_LABEL[reaction]"
          :title="REACTION_LABEL[reaction]"
          :data-reaction="reaction"
          :disabled="limited"
          @click="react(reaction)"
        >
          <span aria-hidden="true">{{ REACTION_EMOJI[reaction] }}</span>
        </button>
      </div>
      <p v-if="limited" class="px-1 pt-1 text-center text-xs text-muted-foreground" role="status">Slow down a little</p>
    </PopoverContent>
  </Popover>
  <Teleport to="body">
    <ReactionsOverlay />
  </Teleport>
</template>
