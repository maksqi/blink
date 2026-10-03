<script setup lang="ts">
/** Call settings: every `settings` section from the feature registries (devices and audio come from core). */
import { Dialog, DialogDescription, DialogHeader, DialogScrollContent, DialogTitle } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { useCallUi, useReturnFocus } from '~/composables/call'
import { callRegistry } from '~/lib/call/features'

const ui = useCallUi()
const sections = callRegistry.settings
// Opened from a menu (More options, device menus): closing returns focus to that menu's button.
const returnFocus = useReturnFocus(ui.settingsOpen)
</script>

<template>
  <Dialog v-model:open="ui.settingsOpen.value">
    <DialogScrollContent class="sm:max-w-lg" data-testid="call-settings" @close-auto-focus="returnFocus">
      <DialogHeader>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>Changes apply right away and stay on this device.</DialogDescription>
      </DialogHeader>
      <div class="flex flex-col gap-6">
        <template v-for="(section, index) in sections" :key="section.id">
          <Separator v-if="index > 0" />
          <section :aria-labelledby="`settings-${section.id}`" class="flex flex-col gap-4">
            <h3 :id="`settings-${section.id}`" class="text-sm font-semibold">{{ section.title }}</h3>
            <component :is="section.component" />
          </section>
        </template>
      </div>
    </DialogScrollContent>
  </Dialog>
</template>
