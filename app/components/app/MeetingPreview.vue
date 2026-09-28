<script setup lang="ts">
/** Decorative meeting window for the landing page. Hidden from assistive technology; the page text says it all. */
import {
  LockKeyholeIcon,
  MessageSquareIcon,
  MicIcon,
  MicOffIcon,
  MonitorUpIcon,
  PhoneOffIcon,
  ShieldCheckIcon,
  VideoIcon,
} from '@lucide/vue'
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()

const tiles = [
  { name: 'Amara', initials: 'AO', tint: 'from-chart-1/45 to-chart-2/15', speaking: true, muted: false },
  { name: 'Kenji', initials: 'KT', tint: 'from-chart-5/35 to-chart-4/15', speaking: false, muted: true },
  { name: 'Lucia', initials: 'LM', tint: 'from-chart-4/40 to-chart-2/15', speaking: false, muted: false },
  { name: 'You', initials: 'YO', tint: 'from-chart-2/40 to-chart-1/15', speaking: false, muted: false },
]
const controls = [MicIcon, VideoIcon, MonitorUpIcon, MessageSquareIcon]
</script>

<template>
  <!-- Bottom padding leaves room for the safety code card, which hangs just below the window. -->
  <div aria-hidden="true" :class="cn('relative w-full max-w-[34rem] pb-[4.5rem] select-none', props.class)">
    <div
      class="overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-primary/10 ring-1 ring-foreground/5 dark:shadow-black/40"
    >
      <div class="flex items-center justify-between gap-3 border-b px-4 py-3">
        <p class="truncate text-sm font-medium">Weekly design review</p>
        <div class="flex shrink-0 items-center gap-2">
          <span
            class="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[0.6875rem] font-medium text-accent-foreground"
          >
            <LockKeyholeIcon class="size-3" />
            Encrypted
          </span>
          <span class="text-xs text-muted-foreground tabular-nums">24:18</span>
        </div>
      </div>

      <!-- The call surface is dark in both themes, like the real call UI. -->
      <div class="dark bg-background">
        <div class="grid grid-cols-2 gap-2 p-2 sm:gap-2.5 sm:p-2.5">
          <div
            v-for="tile in tiles"
            :key="tile.name"
            :class="
              cn(
                'relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-linear-to-br',
                tile.tint,
                tile.speaking && 'ring-2 ring-primary motion-safe:animate-speak',
              )
            "
          >
            <span
              class="flex size-10 items-center justify-center rounded-full bg-background/45 text-sm font-semibold text-foreground ring-1 ring-foreground/10 sm:size-12 sm:text-base"
            >
              {{ tile.initials }}
            </span>
            <span
              class="absolute bottom-1.5 left-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[0.6875rem] font-medium text-white"
            >
              {{ tile.name }}
            </span>
            <span v-if="tile.muted" class="absolute top-1.5 right-1.5 rounded-full bg-black/55 p-1 text-white">
              <MicOffIcon class="size-3" />
            </span>
          </div>
        </div>
        <div class="flex items-center justify-center gap-2 px-3 pt-1 pb-3">
          <span
            v-for="(control, index) in controls"
            :key="index"
            class="flex size-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
          >
            <component :is="control" class="size-4" />
          </span>
          <span class="ml-1 flex h-9 items-center justify-center rounded-full bg-[oklch(0.58_0.2_25)] px-4 text-white">
            <PhoneOffIcon class="size-4" />
          </span>
        </div>
      </div>
    </div>

    <div
      class="absolute bottom-0 left-3 w-60 rounded-xl border bg-popover p-3 text-popover-foreground shadow-xl sm:-left-8 motion-safe:animate-rise motion-safe:[animation-delay:500ms]"
    >
      <p class="flex items-center gap-2 text-xs font-medium">
        <ShieldCheckIcon class="size-4 text-primary" />
        Safety code
      </p>
      <p class="mt-1.5 font-mono text-sm tracking-[0.12em] tabular-nums">7K2M 9QXD 4HPA T8RW</p>
      <p class="mt-1 text-[0.6875rem] text-muted-foreground">Everyone in the call sees the same code.</p>
    </div>
  </div>
</template>
