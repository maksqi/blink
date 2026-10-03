<script setup lang="ts">
/** More-menu entry "Blur background" (on restores the last blur level). Disabled with the reason where unsupported. */
import { ApertureIcon } from '@lucide/vue'
import { computed } from 'vue'
import { DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu'
import { useCall } from '~/composables/call'
import { effectsFor } from '~/lib/call/features/effects/controller'

const effects = effectsFor(useCall())
const state = effects?.state

const on = computed(() => state?.blur !== 'off')

function toggle() {
  void effects?.toggleBlur()
}
</script>

<template>
  <DropdownMenuCheckboxItem
    v-if="state"
    :model-value="on"
    :disabled="!state.blurSupport.ok"
    data-testid="blur-toggle"
    @update:model-value="toggle"
  >
    <ApertureIcon aria-hidden="true" />
    <span class="flex min-w-0 flex-col">
      <span>Blur background</span>
      <span v-if="!state.blurSupport.ok" class="text-xs text-muted-foreground">{{ state.blurSupport.reason }}</span>
      <span v-else-if="state.blurLoading" class="text-xs text-muted-foreground">Loading…</span>
    </span>
  </DropdownMenuCheckboxItem>
</template>
