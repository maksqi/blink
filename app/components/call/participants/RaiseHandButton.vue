<script setup lang="ts">
/**
 * Raise or lower your hand (`POST /me/hand`). The state shown is the server-set `hand` attribute; while a request is
 * on its way the button shows it as pending instead of flipping early.
 */
import { HandIcon } from '@lucide/vue'
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import CallControlButton from '~/components/call/core/CallControlButton.vue'
import { useCall } from '~/composables/call'
import { callActions } from '~/lib/call/features/host-actions/state'

/** Give up waiting for the attribute after this long (the API answered; LiveKit may be slow). */
const PENDING_MS = 4_000

const ctx = useCall()
const raised = computed(() => ctx.self.value?.handRaisedAt != null)
const phaseBlocked = computed(() => ctx.phase.value !== 'inCall')
const pending = shallowRef(false)
let timer: ReturnType<typeof setTimeout> | null = null
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})

watch(raised, () => {
  pending.value = false
  if (timer) clearTimeout(timer)
})

async function toggle() {
  if (pending.value || phaseBlocked.value) return
  pending.value = true
  const result = await callActions(ctx).setHand(!raised.value)
  if (!result.ok) {
    pending.value = false
    return
  }
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => (pending.value = false), PENDING_MS)
}
</script>

<template>
  <CallControlButton
    :label="raised ? 'Lower hand' : 'Raise hand'"
    :icon="HandIcon"
    :pressed="raised"
    :tone="raised ? 'active' : 'default'"
    :disabled="pending || phaseBlocked"
    :disabled-reason="pending ? 'Updating your hand' : undefined"
    data-control="raise-hand"
    :data-pending="pending || undefined"
    @click="toggle"
  />
</template>
