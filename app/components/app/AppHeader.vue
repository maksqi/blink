<script setup lang="ts">
import { Button } from '@/components/ui/button'
import AppLogo from './AppLogo.vue'
import AppNav from './AppNav.vue'
import MobileNav from './MobileNav.vue'
import ThemeToggle from './ThemeToggle.vue'
import UserMenu from './UserMenu.vue'

const user = useAuthState()
</script>

<template>
  <header
    class="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70"
  >
    <div class="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-4 sm:px-6 lg:px-8">
      <!-- Phones: navigation and account live in a sheet. Tablets and desktops: inline. -->
      <MobileNav class="md:hidden" />
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
