<script setup lang="ts">
/** Overflow-menu entries of the core feature: layout, settings and keyboard shortcuts. */
import { KeyboardIcon, LayoutGridIcon, SettingsIcon, SquareUserIcon } from '@lucide/vue'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu'
import { useCallSession, useCallUi } from '~/composables/call'
import type { LayoutMode } from '~/lib/contracts/call'

const props = defineProps<{ entry: 'layout' | 'settings' | 'hotkeys' }>()

const session = useCallSession()
const ui = useCallUi()

function setLayout(value: unknown) {
  if (value === 'grid' || value === 'speaker') session.store.layout = value as LayoutMode
}
</script>

<template>
  <template v-if="props.entry === 'layout'">
    <DropdownMenuLabel>Layout</DropdownMenuLabel>
    <DropdownMenuRadioGroup :model-value="session.store.layout" @update:model-value="setLayout">
      <DropdownMenuRadioItem value="grid">
        <LayoutGridIcon aria-hidden="true" />
        Grid
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="speaker">
        <SquareUserIcon aria-hidden="true" />
        Speaker
      </DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
    <DropdownMenuSeparator />
  </template>
  <DropdownMenuItem v-else-if="props.entry === 'settings'" @select="ui.settingsOpen.value = true">
    <SettingsIcon aria-hidden="true" />
    Settings
  </DropdownMenuItem>
  <DropdownMenuItem v-else @select="ui.hotkeysOpen.value = true">
    <KeyboardIcon aria-hidden="true" />
    Keyboard shortcuts
    <DropdownMenuShortcut>?</DropdownMenuShortcut>
  </DropdownMenuItem>
</template>
