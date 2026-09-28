<script setup lang="ts">
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { useCallUi } from '~/composables/call'

const ui = useCallUi()

const shortcuts = [
  { keys: ['M'], text: 'Turn your microphone on or off' },
  { keys: ['V'], text: 'Turn your camera on or off' },
  { keys: ['Space'], text: 'Hold to talk while muted' },
  { keys: ['?'], text: 'Show keyboard shortcuts' },
]
</script>

<template>
  <Dialog v-model:open="ui.hotkeysOpen.value">
    <DialogContent class="sm:max-w-md" data-testid="hotkey-help">
      <DialogHeader>
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>
          They work anywhere in the call except in text fields. Other keyboard layouts use the same keys.
        </DialogDescription>
      </DialogHeader>
      <dl class="divide-y divide-border">
        <div v-for="shortcut in shortcuts" :key="shortcut.text" class="flex items-center justify-between gap-4 py-2.5">
          <dt class="text-sm">{{ shortcut.text }}</dt>
          <dd class="flex gap-1">
            <Kbd v-for="key in shortcut.keys" :key="key">{{ key }}</Kbd>
          </dd>
        </div>
      </dl>
    </DialogContent>
  </Dialog>
</template>
