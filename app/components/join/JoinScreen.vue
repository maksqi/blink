<script setup lang="ts">
/**
 * Centered screen of the `/m/<slug>` flow (loading, errors, password, waiting room, another tab): an icon tile, a
 * title, a short text and the actions. Matches the call's end screens, on the call layout's dark ground.
 */
import type { Component } from 'vue'

defineProps<{
  icon: Component
  title: string
  description?: string
  /** Meeting name, shown above the title. */
  meeting?: string
  /** Spin the icon (loading states). */
  busy?: boolean
}>()
defineSlots<{ default?(): unknown; media?(): unknown; description?(): unknown }>()
</script>

<template>
  <div class="flex min-h-full flex-1 items-center justify-center px-4 py-10 sm:px-6">
    <div class="flex w-full max-w-md flex-col items-center text-center">
      <slot name="media">
        <span
          class="flex size-14 items-center justify-center rounded-2xl bg-white/8 text-white/90 ring-1 ring-white/10"
        >
          <component
            :is="icon"
            class="size-7"
            :class="busy ? 'motion-safe:animate-spin' : undefined"
            aria-hidden="true"
          />
        </span>
      </slot>
      <p v-if="meeting" class="mt-5 max-w-full truncate text-sm text-muted-foreground">{{ meeting }}</p>
      <h1 class="text-xl font-semibold tracking-tight text-balance" :class="meeting ? 'mt-1' : 'mt-5'">{{ title }}</h1>
      <p v-if="description || $slots.description" class="mt-2 text-sm text-pretty text-muted-foreground">
        <slot name="description">{{ description }}</slot>
      </p>
      <div v-if="$slots.default" class="mt-6 flex w-full flex-col items-center gap-3">
        <slot />
      </div>
    </div>
  </div>
</template>
