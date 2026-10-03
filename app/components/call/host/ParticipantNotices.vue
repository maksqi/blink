<script setup lang="ts">
/**
 * The participant side of moderation that needs a mounted component (registered as a zero-footprint control-bar item;
 * it renders only portaled dialogs):
 * - the "The host asks you to unmute" prompt: nothing changes until the person clicks Unmute;
 * - after a server mute, call-core's microphone/camera/screen-share toggles are brought in line with the muted track,
 *   so one click turns it back on;
 * - it hands the call view's UI state to toasts and menus (opening side panels).
 */
import { MicIcon } from '@lucide/vue'
import { onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useCall, useCallSession, useCallUi } from '~/composables/call'
import { CAPTURE_ERROR_TEXT } from '~/lib/call/devices'
import { hostActionsState } from '~/lib/call/features/host-actions/state'
import { callToast } from '~/lib/call/notify'

/** How long Unmute waits for a microphone permission that is still on its way (give voice, then ask). */
const PERMISSION_WAIT_MS = 3_000

const ctx = useCall()
const session = useCallSession()
const ui = useCallUi()
const state = hostActionsState(ctx)
const { askUnmute } = state
const unmuting = shallowRef(false)

onMounted(() => {
  state.ui.value = ui
})
onBeforeUnmount(() => {
  if (state.ui.value === ui) state.ui.value = null
})

watch(state.serverMuted, (event) => {
  if (!event) return
  // The server muted the published track; switch the local toggle off too (no extra media change).
  if (event.source === 'microphone') void session.setMicEnabled(false).catch(() => undefined)
  else if (event.source === 'camera') void session.setCameraEnabled(false).catch(() => undefined)
  else void session.stopScreenShare().catch(() => undefined)
})

function waitForMicPermission(): Promise<boolean> {
  if (session.store.permissions.microphone) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      stop()
      resolve(false)
    }, PERMISSION_WAIT_MS)
    const stop = watch(
      () => session.store.permissions.microphone,
      (allowed) => {
        if (!allowed) return
        clearTimeout(timer)
        stop()
        resolve(true)
      },
    )
  })
}

function onOpenChange(open: boolean) {
  if (!open) askUnmute.value = false
}

async function unmute() {
  if (unmuting.value) return
  unmuting.value = true
  try {
    if (!(await waitForMicPermission())) {
      callToast.error("The host hasn't allowed your microphone yet.")
      return
    }
    await session.setMicEnabled(true)
    askUnmute.value = false
  } catch {
    const reason = session.store.media.micError
    callToast.error(reason ? CAPTURE_ERROR_TEXT.microphone[reason] : 'Could not turn on your microphone.')
  } finally {
    unmuting.value = false
  }
}
</script>

<template>
  <AlertDialog :open="askUnmute" @update:open="onOpenChange">
    <AlertDialogContent data-testid="ask-unmute-dialog" size="sm">
      <AlertDialogHeader>
        <AlertDialogTitle class="flex items-center gap-2">
          <MicIcon class="size-5 text-primary" aria-hidden="true" />
          The host asks you to unmute
        </AlertDialogTitle>
        <AlertDialogDescription>Your microphone stays off until you choose to unmute.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel data-testid="ask-unmute-stay">Stay muted</AlertDialogCancel>
        <Button data-testid="ask-unmute-accept" :disabled="unmuting" @click="unmute">Unmute</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
