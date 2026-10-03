<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { Button } from '@/components/ui/button'
import AppLogo from './AppLogo.vue'
import AppNav from './AppNav.vue'
import ThemeToggle from './ThemeToggle.vue'

// Only signed-in people get the account menu and the phone menu: visitors (landing, sign-in) never load their code
// (the reka-ui sheet and menu).
const MobileNav = defineAsyncComponent(() => import('./MobileNav.vue'))
const UserMenu = defineAsyncComponent(() => import('./UserMenu.vue'))

const user = useAuthState()
</script>

<template>
  <header
    class="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70"
  >
    <div class="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-4 sm:px-6 lg:px-8">
      <!-- Phones: navigation and account live in a sheet. Tablets and desktops: inline. -->
      <MobileNav v-if="user" class="md:hidden" />
      <AppLogo class="mr-3 lg:mr-5" />
      <AppNav class="hidden md:flex" />

      <div class="ml-auto flex items-center gap-1">
        <ThemeToggle />
        <div v-if="user" class="hidden md:block">
          <UserMenu />
        </div>
        <Button v-else as-child size="sm" class="ml-1 px-3.5">
          <NuxtLink to="/login">Sign in</NuxtLink>
        </Button>
      </div>
    </div>
  </header>
</template>
