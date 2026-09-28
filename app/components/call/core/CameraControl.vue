<script setup lang="ts">
import { VideoIcon, VideoOffIcon } from '@lucide/vue'
import { computed } from 'vue'
import { toast } from 'vue-sonner'
import CallControlButton from './CallControlButton.vue'
import DeviceMenu from './DeviceMenu.vue'
import { useCallSession } from '~/composables/call'
import { CAPTURE_ERROR_TEXT } from '~/lib/call/devices'

const session = useCallSession()
const store = session.store

const on = computed(() => store.media.cameraOn)
const allowed = computed(() => store.permissions.camera)
const reason = computed(() => {
  if (!allowed.value) return 'The host turned off your camera'
  if (store.media.cameraError) return CAPTURE_ERROR_TEXT.camera[store.media.cameraError]
  return undefined
})

async function toggle() {
  try {
    await session.toggleCamera()
  } catch {
    if (store.media.cameraError) toast.error(CAPTURE_ERROR_TEXT.camera[store.media.cameraError])
  }
}
</script>

<template>
  <div class="flex shrink-0 items-center" data-control="camera">
    <CallControlButton
      label="Camera"
      :icon="on ? VideoIcon : VideoOffIcon"
      :pressed="on"
      :tone="on ? 'default' : 'off'"
      :disabled="!allowed || store.media.cameraBusy"
      :disabled-reason="reason"
      shortcut="V"
      class="min-[480px]:rounded-r-none min-[480px]:pr-2 min-[480px]:pl-3"
      @click="toggle"
    />
    <DeviceMenu kind="camera" />
  </div>
</template>
