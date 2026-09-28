<script setup lang="ts">
/** First focusable element of every layout. Moves focus to `#main` without adding a hash to the URL. */
function skip(event: MouseEvent) {
  const target = document.getElementById('main')
  if (!target) return
  event.preventDefault()
  target.focus()
}
</script>

<template>
  <a
    href="#main"
    class="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg"
    @click="skip"
  >
    Skip to content
  </a>
</template>
