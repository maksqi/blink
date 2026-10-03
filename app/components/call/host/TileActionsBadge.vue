<script setup lang="ts">
/** Moderation menu on a tile (registry tile badge). Renders only for moderators with something to offer. */
import ParticipantActionsMenu from './ParticipantActionsMenu.vue'
import type { ParticipantView } from '~/lib/contracts/call'

defineProps<{ participant: ParticipantView }>()
</script>

<template>
  <ParticipantActionsMenu v-if="!participant.isLocal" :participant="participant" variant="tile" />
</template>
