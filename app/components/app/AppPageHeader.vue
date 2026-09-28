<script setup lang="ts">
/**
 * Page title row for pages in the `default` and `admin` layouts:
 *   <AppPageHeader title="Recordings" description="...">
 *     <template #actions><Button>...</Button></template>
 *   </AppPageHeader>
 */
defineProps<{ title: string; description?: string }>()
defineSlots<{ description?(): unknown; actions?(): unknown }>()
</script>

<template>
  <div class="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 sm:mb-8">
    <div class="min-w-0 space-y-1.5">
      <h1 class="text-2xl font-semibold tracking-tight text-balance sm:text-[1.75rem]">{{ title }}</h1>
      <p v-if="description || $slots.description" class="max-w-prose text-sm text-muted-foreground sm:text-base">
        <slot name="description">{{ description }}</slot>
      </p>
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
