<script setup lang="ts">
/**
 * `default` layout: sticky header (logo, main navigation, theme, account) and a centered content column
 * (max 72rem). Pages render their content directly; `<AppPageHeader>` gives them a consistent title row.
 */
import AppHeader from '@/components/app/AppHeader.vue'
import SkipLink from '@/components/app/SkipLink.vue'
</script>

<template>
  <div class="relative flex min-h-svh flex-col">
    <SkipLink />
    <AppHeader />
    <main
      id="main"
      tabindex="-1"
      class="mx-auto w-full max-w-6xl flex-1 px-4 py-6 outline-none sm:px-6 sm:py-10 lg:px-8"
    >
      <slot />
    </main>
  </div>
</template>
