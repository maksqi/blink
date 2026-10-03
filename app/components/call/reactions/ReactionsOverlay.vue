<script setup lang="ts">
/**
 * Floating reactions above the call (fixed layer, `pointer-events: none`): the emoji and the sender's name for about
 * 3 s, at most 20 at once. With `prefers-reduced-motion` they only fade.
 */
import { computed } from 'vue'
import { useCall } from '~/composables/call'
import { REACTION_EMOJI, REACTION_LABEL } from '~/lib/call/features/reactions/feed'
import { reactionsState } from '~/lib/call/features/reactions/useReactions'

const ctx = useCall()
const reactions = reactionsState(ctx)
const items = computed(() => reactions.items.value)
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 bottom-24 z-40 h-64 overflow-hidden"
    aria-hidden="true"
    data-testid="reactions-overlay"
  >
    <div
      v-for="item in items"
      :key="item.id"
      class="reaction absolute bottom-0 flex flex-col items-center gap-1"
      :style="{ left: `${8 + item.lane * 76}%` }"
      data-testid="reaction-item"
      :data-reaction="item.reaction"
      :data-identity="item.identity"
      :title="REACTION_LABEL[item.reaction]"
    >
      <span class="text-4xl drop-shadow-md">{{ REACTION_EMOJI[item.reaction] }}</span>
      <span
        class="max-w-32 truncate rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white"
        data-testid="reaction-sender"
        >{{ item.name }}</span
      >
    </div>
  </div>
</template>

<style scoped>
.reaction {
  animation: reaction-float 3s ease-out forwards;
}

@keyframes reaction-float {
  0% {
    opacity: 0;
    transform: translateY(0) scale(0.6);
  }
  12% {
    opacity: 1;
    transform: translateY(-12px) scale(1);
  }
  80% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translateY(-180px) scale(1);
  }
}

@keyframes reaction-fade {
  0%,
  100% {
    opacity: 0;
  }
  10%,
  80% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .reaction {
    animation-name: reaction-fade;
  }
}
</style>
