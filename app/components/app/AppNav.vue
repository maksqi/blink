<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { isNavItemActive, mainNav } from '~/lib/shell/nav'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()

const user = useAuthState()
const route = useRoute()
const items = computed(() => mainNav(user.value))
</script>

<template>
  <nav v-if="items.length" aria-label="Main" :class="cn('items-center', props.class)">
    <ul class="flex items-center gap-1">
      <li v-for="item in items" :key="item.to">
        <NuxtLink
          :to="item.to"
          :aria-current="isNavItemActive(item, route.path) ? 'page' : undefined"
          class="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
        >
          <component :is="item.icon" class="size-4" aria-hidden="true" />
          {{ item.label }}
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>
