<script setup lang="ts">
/**
 * The theme menu behind `<ThemeToggle>`: light, dark or the system setting. Loaded on first use, so pages do not pay
 * for the menu code (reka-ui menu, floating-ui) until someone opens it.
 */
import { MonitorIcon, MoonIcon, SunIcon } from '@lucide/vue'
import type { HTMLAttributes } from 'vue'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const props = defineProps<{ class?: HTMLAttributes['class']; defaultOpen?: boolean }>()

const THEMES = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'System', icon: MonitorIcon },
] as const

const colorMode = useColorMode()
// color-mode persists the preference (localStorage `blinq-color-mode`) and applies the class on <html>.
const preference = computed({
  get: () => colorMode.preference,
  set: (value: string) => {
    colorMode.preference = value
  },
})
</script>

<template>
  <DropdownMenu :default-open="props.defaultOpen">
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="icon" :class="props.class" aria-label="Change theme" data-testid="theme-toggle">
        <!-- Driven by the html class, which the color-mode head script sets before the first paint. -->
        <SunIcon class="dark:hidden" aria-hidden="true" />
        <MoonIcon class="hidden dark:block" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-40">
      <DropdownMenuLabel class="text-xs font-medium text-muted-foreground">Theme</DropdownMenuLabel>
      <DropdownMenuRadioGroup v-model="preference">
        <DropdownMenuRadioItem v-for="theme in THEMES" :key="theme.value" :value="theme.value">
          <component :is="theme.icon" aria-hidden="true" />
          {{ theme.label }}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
