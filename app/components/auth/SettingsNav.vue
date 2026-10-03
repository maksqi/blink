<script setup lang="ts">
/** Section tabs of the account settings (`/settings`, `/settings/sessions`). */
import { MonitorSmartphoneIcon, UserRoundIcon } from '@lucide/vue'

const route = useRoute()
const items = [
  { to: '/settings', label: 'Profile and password', icon: UserRoundIcon },
  { to: '/settings/sessions', label: 'Devices', icon: MonitorSmartphoneIcon },
]
const current = (to: string) => route.path.replace(/\/+$/, '') === to
</script>

<template>
  <nav aria-label="Settings sections" class="mb-6 overflow-x-auto border-b sm:mb-8">
    <ul class="-mb-px flex min-w-max gap-1">
      <li v-for="item in items" :key="item.to">
        <NuxtLink
          :to="item.to"
          :aria-current="current(item.to) ? 'page' : undefined"
          class="inline-flex h-10 items-center gap-2 pointer-coarse:h-11 border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:text-foreground"
        >
          <component :is="item.icon" class="size-4" aria-hidden="true" />
          {{ item.label }}
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>
