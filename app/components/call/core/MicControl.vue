<script setup lang="ts">
import { MicIcon, MicOffIcon } from '@lucide/vue'
import { computed } from 'vue'
import CallControlButton from './CallControlButton.vue'
import DeviceMenu from './DeviceMenu.vue'
import { useCallSession } from '~/composables/call'
import { callToast } from '~/lib/call/notify'
import { CAPTURE_ERROR_TEXT } from '~/lib/call/devices'

const session = useCallSession()
const store = session.store

const on = computed(() => store.media.micOn)
const allowed = computed(() => store.permissions.microphone)
const reason = computed(() => {
  if (!allowed.value) return 'The host turned off your microphone'
  if (store.media.micError) return CAPTURE_ERROR_TEXT.microphone[store.media.micError]
  return undefined
})

async function toggle() {
  try {
    await session.toggleMic()
  } catch {
    if (store.media.micError) callToast.error(CAPTURE_ERROR_TEXT.microphone[store.media.micError])
  }
}
</script>

<template>
  <div class="flex shrink-0 items-center" data-control="microphone">
    <CallControlButton
      label="Microphone"
      :icon="on ? MicIcon : MicOffIcon"
      :pressed="on"
      :tone="on ? 'default' : 'off'"
      :disabled="!allowed || store.media.micBusy"
      :disabled-reason="reason"
      shortcut="M"
      class="min-[480px]:rounded-r-none min-[480px]:pr-2 min-[480px]:pl-3"
      @click="toggle"
    />
    <DeviceMenu kind="microphone" />
  </div>
</template>
