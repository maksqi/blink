<script setup lang="ts">
/** Shown instead of pre-join and the call when the browser cannot do E2EE. blinq never connects unencrypted. */
import { ShieldOffIcon } from '@lucide/vue'

defineProps<{ message: string }>()
</script>

<template>
  <div class="flex min-h-full flex-1 items-center justify-center p-6" data-testid="unsupported-browser">
    <div class="flex max-w-md flex-col items-center text-center">
      <span class="flex size-14 items-center justify-center rounded-2xl bg-white/8 text-white/90 ring-1 ring-white/10">
        <ShieldOffIcon class="size-7" aria-hidden="true" />
      </span>
      <h1 class="mt-5 text-xl font-semibold tracking-tight">This browser can't join encrypted calls</h1>
      <p class="mt-2 text-sm text-muted-foreground">{{ message }}</p>
      <p class="mt-4 text-xs text-muted-foreground">
        Every blinq call is end-to-end encrypted. There is no unencrypted fallback.
      </p>
    </div>
  </div>
</template>
