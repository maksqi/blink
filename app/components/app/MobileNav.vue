<script setup lang="ts">
import { LogOutIcon, MenuIcon, SettingsIcon } from '@lucide/vue'
import type { HTMLAttributes } from 'vue'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { initials } from '~/lib/shell/initials'
import { isNavItemActive, mainNav } from '~/lib/shell/nav'
import AppLogo from './AppLogo.vue'
import SignOutAction from './SignOutAction.vue'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()

const user = useAuthState()
const route = useRoute()
const open = ref(false)
const items = computed(() => mainNav(user.value))

// Close after every navigation, including links outside the sheet (browser back).
watch(
  () => route.fullPath,
  () => {
    open.value = false
  },
)

const itemClass =
  'flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground'
</script>

<template>
  <Sheet v-if="user" v-model:open="open">
    <SheetTrigger as-child>
      <Button variant="ghost" size="icon" :class="cn('-ml-2', props.class)" aria-label="Open menu" data-testid="mobile-nav-trigger">
        <MenuIcon aria-hidden="true" />
      </Button>
    </SheetTrigger>
    <SheetContent side="left" class="w-[min(20rem,85vw)] gap-0 p-0" data-testid="mobile-nav">
      <SheetHeader class="border-b px-4 py-3.5">
        <SheetTitle class="sr-only">Menu</SheetTitle>
        <SheetDescription class="sr-only">Pages and account</SheetDescription>
        <AppLogo />
      </SheetHeader>

      <nav aria-label="Main" class="flex-1 overflow-y-auto p-3">
        <ul class="flex flex-col gap-1">
          <li v-for="item in items" :key="item.to">
            <NuxtLink
              :to="item.to"
              :aria-current="isNavItemActive(item, route.path) ? 'page' : undefined"
              :class="itemClass"
            >
              <component :is="item.icon" class="size-4.5" aria-hidden="true" />
              {{ item.label }}
            </NuxtLink>
          </li>
        </ul>
      </nav>

      <div class="border-t p-3">
        <div class="flex items-center gap-3 px-3 py-2">
          <Avatar>
            <AvatarFallback class="bg-primary/12 text-xs font-semibold text-primary">
              {{ initials(user.displayName) }}
            </AvatarFallback>
          </Avatar>
          <div class="min-w-0">
            <p class="truncate text-sm font-medium">{{ user.displayName }}</p>
            <p class="truncate text-xs text-muted-foreground">{{ user.email }}</p>
          </div>
        </div>
        <NuxtLink
          to="/settings"
          :aria-current="isNavItemActive({ to: '/settings' }, route.path) ? 'page' : undefined"
          :class="itemClass"
        >
          <SettingsIcon class="size-4.5" aria-hidden="true" />
          Settings
        </NuxtLink>
        <SignOutAction v-slot="{ signOut, pending }">
          <button type="button" :class="cn(itemClass, 'w-full')" :disabled="pending" @click="signOut">
            <LogOutIcon class="size-4.5" aria-hidden="true" />
            Sign out
          </button>
        </SignOutAction>
      </div>
    </SheetContent>
  </Sheet>
</template>
