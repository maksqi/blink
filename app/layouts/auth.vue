<script setup lang="ts">
/**
 * `auth` layout for sign-in style pages (login, register, invite, verify, reset and change password). It renders a
 * centered `<Card>`: pages supply only its parts, e.g.
 *   <CardHeader><CardTitle>Sign in</CardTitle><CardDescription>...</CardDescription></CardHeader>
 *   <CardContent>form</CardContent>
 *   <CardFooter>links</CardFooter>
 * There is no navigation here, which also covers the forced password change.
 */
import { LockKeyholeIcon } from '@lucide/vue'
import { Card } from '@/components/ui/card'
import AppLogo from '@/components/app/AppLogo.vue'
import SkipLink from '@/components/app/SkipLink.vue'
import ThemeToggle from '@/components/app/ThemeToggle.vue'
</script>

<template>
  <div class="relative isolate flex min-h-svh flex-col overflow-hidden bg-muted/50">
    <SkipLink />
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[32rem] bg-[radial-gradient(55%_65%_at_50%_0%,color-mix(in_oklch,var(--primary)_16%,transparent),transparent)]"
    />
    <header class="flex items-center justify-between px-4 py-4 sm:px-6">
      <AppLogo />
      <ThemeToggle />
    </header>
    <main
      id="main"
      tabindex="-1"
      class="flex flex-1 flex-col items-center justify-center px-4 pt-4 pb-16 outline-none sm:pb-24"
    >
      <Card class="w-full max-w-sm shadow-xl shadow-foreground/5 motion-safe:animate-rise">
        <slot />
      </Card>
      <p class="mt-6 flex items-center gap-1.5 text-center text-xs text-muted-foreground">
        <LockKeyholeIcon class="size-3.5 shrink-0" aria-hidden="true" />
        End-to-end encrypted meetings on your own server
      </p>
    </main>
  </div>
</template>
