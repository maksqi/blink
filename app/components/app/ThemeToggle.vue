<script setup lang="ts">
/**
 * Theme button in every header. Until it is used it is a plain button: the menu (`ThemeMenu.vue`, with the reka-ui
 * menu and floating-ui) is fetched when the pointer comes near or the button gets focus, and replaces the button,
 * already open, when it is pressed. Pages that nobody themes load none of it (F-043, initial JS budget).
 */
import { MoonIcon, SunIcon } from '@lucide/vue'
import { markRaw, shallowRef, type Component, type HTMLAttributes } from 'vue'
import { Button } from '@/components/ui/button'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()

let loading: Promise<Component> | null = null
const menu = shallowRef<Component | null>(null)

function loadMenu(): Promise<Component> {
  loading ??= import('./ThemeMenu.vue').then((module) => markRaw(module.default))
  // A failed download may work on the next attempt.
  loading.catch(() => {
    loading = null
  })
  return loading
}

function preload() {
  loadMenu().catch(() => {})
}

async function open() {
  try {
    menu.value = await loadMenu()
  } catch {
    // Offline: the button stays; the next press tries again.
  }
}
</script>

<template>
  <component :is="menu" v-if="menu" :class="props.class" default-open />
  <Button
    v-else
    variant="ghost"
    size="icon"
    :class="props.class"
    aria-label="Change theme"
    aria-haspopup="menu"
    aria-expanded="false"
    data-testid="theme-toggle"
    @pointerenter="preload"
    @focus="preload"
    @click="open"
  >
    <!-- Driven by the html class, which the color-mode head script sets before the first paint. -->
    <SunIcon class="dark:hidden" aria-hidden="true" />
    <MoonIcon class="hidden dark:block" aria-hidden="true" />
  </Button>
</template>
