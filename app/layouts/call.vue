<script setup lang="ts">
/**
 * `call` layout: the full viewport with no chrome; the call UI owns everything, landmarks included.
 * Surfaces are always dark (the `dark` class scopes the dark tokens to this subtree), because video reads best on a
 * dark ground. Overlays teleported to <body> (menus, dialogs, toasts) follow the global theme unless the page forces
 * it with `definePageMeta({ colorMode: 'dark' })`.
 */
</script>

<template>
  <div
    class="dark fixed inset-0 flex flex-col overflow-hidden overscroll-none bg-background text-foreground"
    data-layout="call"
  >
    <slot />
  </div>
</template>
