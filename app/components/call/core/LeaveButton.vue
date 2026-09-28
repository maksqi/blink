<script setup lang="ts">
import { PhoneOffIcon } from '@lucide/vue'
import CallControlButton from './CallControlButton.vue'
import { useCallSession } from '~/composables/call'

const session = useCallSession()
</script>

<template>
  <CallControlButton
    label="Leave call"
    :icon="PhoneOffIcon"
    tone="danger"
    text="Leave"
    class="px-4"
    data-control="leave"
    @click="session.leave()"
  />
</template>
