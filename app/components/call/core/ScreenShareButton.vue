<script setup lang="ts">
/**
 * Screen share (h720fps5 … h1080fps30 within the admin limits; tab or system audio when the browser offers it).
 * Hidden on iOS and Android and for participants when the host limits sharing to hosts.
 */
import { MonitorUpIcon, MonitorXIcon } from '@lucide/vue'
import { computed } from 'vue'
import CallControlButton from './CallControlButton.vue'
import { useCallSession } from '~/composables/call'
import { callToast } from '~/lib/call/notify'

const session = useCallSession()
const store = session.store

const visible = computed(() => {
  void store.permissions
  void store.roomState
  void store.role
  return session.canShareScreen || store.screenShare.active
})
const active = computed(() => store.screenShare.active)

async function toggle() {
  try {
    if (active.value) await session.stopScreenShare()
    else await session.startScreenShare()
  } catch {
    callToast.error("Screen sharing didn't start. Try again or pick another window.")
  }
}
</script>

<template>
  <CallControlButton
    v-if="visible"
    :label="active ? 'Stop presenting' : 'Share screen'"
    :icon="active ? MonitorXIcon : MonitorUpIcon"
    :pressed="active"
    :tone="active ? 'active' : 'default'"
    :disabled="store.screenShare.busy"
    data-control="screen-share"
    @click="toggle"
  />
</template>
