<script setup lang="ts">
import { ShieldCheckIcon } from '@lucide/vue'
import { computed } from 'vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useCallSession, useCallUi } from '~/composables/call'

const session = useCallSession()
const ui = useCallUi()
const groups = computed(() => session.store.safetyCode?.split('-') ?? [])
</script>

<template>
  <Dialog v-model:open="ui.safetyCodeOpen.value">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <ShieldCheckIcon class="size-5 text-primary" aria-hidden="true" />
          Compare the safety code
        </DialogTitle>
        <DialogDescription>
          Read the code aloud. If everyone sees the same code, everyone holds the same meeting key.
        </DialogDescription>
      </DialogHeader>
      <div
        class="flex flex-wrap justify-center gap-2 rounded-xl bg-muted px-4 py-5 font-mono text-2xl tracking-[0.14em] tabular-nums"
        :aria-label="`Safety code ${session.store.safetyCode ?? ''}`"
        role="group"
      >
        <span v-for="(group, index) in groups" :key="index" class="rounded-md bg-background px-2 py-1" v-text="group" />
      </div>
      <p class="text-sm text-muted-foreground">
        The code proves only that you share the same key. It does not prove who someone is: anyone with the link has the
        key. If a code differs, leave and ask the host for a new link.
      </p>
      <DialogFooter>
        <Button @click="ui.safetyCodeOpen.value = false">Done</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
