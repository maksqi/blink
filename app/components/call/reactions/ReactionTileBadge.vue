<script setup lang="ts">
/** The participant's latest reaction on their tile, for about 3 s (registry tile badge). */
import { computed } from 'vue'
import { useCall } from '~/composables/call'
import { REACTION_EMOJI, REACTION_LABEL } from '~/lib/call/features/reactions/feed'
import { reactionsState } from '~/lib/call/features/reactions/useReactions'
import type { ParticipantView } from '~/lib/contracts/call'

const props = defineProps<{ participant: ParticipantView }>()

const reactions = reactionsState(useCall())
const latest = computed(() => reactions.latestOf(props.participant.identity))
</script>

<template>
  <span
    v-if="latest"
    :key="latest.id"
    role="img"
    :aria-label="`Reacted: ${REACTION_LABEL[latest.reaction]}`"
    class="inline-flex size-6 items-center justify-center rounded-md bg-black/55 text-sm motion-safe:animate-in motion-safe:zoom-in-50"
    data-testid="tile-reaction"
    :data-reaction="latest.reaction"
    >{{ REACTION_EMOJI[latest.reaction] }}</span
  >
</template>
