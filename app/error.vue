<script setup lang="ts">
/**
 * Error page for 404, 403, 401 and 5xx. The copy depends only on the status code: server messages and stack traces
 * are never rendered. Standalone on purpose (no layout), so a broken layout cannot break the error page too.
 */
import { CompassIcon, KeyRoundIcon, RefreshCwIcon, ServerCrashIcon, ShieldAlertIcon } from '@lucide/vue'
import type { NuxtError } from '#app'
import { Button } from '@/components/ui/button'
import AppLogo from '@/components/app/AppLogo.vue'
import ThemeToggle from '@/components/app/ThemeToggle.vue'
import { errorCopy } from '~/lib/shell/error-copy'

const props = defineProps<{ error: NuxtError }>()

const user = useAuthState()
const copy = computed(() => errorCopy(props.error.statusCode))
const icon = computed(() => {
  switch (copy.value.kind) {
    case 'not-found':
    case 'client':
      return CompassIcon
    case 'forbidden':
      return ShieldAlertIcon
    case 'unauthenticated':
      return KeyRoundIcon
    default:
      return ServerCrashIcon
  }
})
const home = computed(() => (user.value ? { to: '/dashboard', label: 'Go to dashboard' } : { to: '/', label: 'Go home' }))
const canRetry = computed(() => copy.value.kind === 'server' || copy.value.kind === 'unavailable')

useHead({ title: computed(() => copy.value.title) })

function leave(to: string) {
  clearError({ redirect: to })
}

function retry() {
  window.location.reload()
}
</script>

<template>
  <div class="relative isolate flex min-h-svh flex-col overflow-hidden bg-background">
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[30rem] bg-[radial-gradient(50%_60%_at_50%_0%,color-mix(in_oklch,var(--primary)_12%,transparent),transparent)]"
    />
    <header class="flex items-center justify-between px-4 py-4 sm:px-6">
      <AppLogo :to="false" />
      <ThemeToggle />
    </header>

    <main id="main" class="flex flex-1 items-center justify-center px-4 pb-20">
      <div class="flex max-w-md flex-col items-center text-center motion-safe:animate-rise">
        <div
          class="mb-6 flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground ring-1 ring-primary/15"
        >
          <component :is="icon" class="size-6" aria-hidden="true" />
        </div>
        <p class="text-sm font-medium text-primary tabular-nums">Error {{ copy.status }}</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{{ copy.title }}</h1>
        <p class="mt-3 text-base text-pretty text-muted-foreground">{{ copy.description }}</p>
        <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button v-if="copy.kind === 'unauthenticated'" size="lg" class="px-4" @click="leave('/login')">
            Sign in
          </Button>
          <Button
            :variant="copy.kind === 'unauthenticated' ? 'outline' : 'default'"
            size="lg"
            class="px-4"
            @click="leave(home.to)"
          >
            {{ home.label }}
          </Button>
          <Button v-if="canRetry" variant="outline" size="lg" class="px-4" @click="retry">
            <RefreshCwIcon aria-hidden="true" />
            Try again
          </Button>
        </div>
      </div>
    </main>
  </div>
</template>
