<script setup lang="ts">
/**
 * A result or state inside the `auth` layout card (link checked, email sent, link invalid ...): icon, heading, text
 * and actions. Use it as the whole card content:
 *   <AuthStatus tone="error" title="This link has expired" description="...">
 *     <Button as-child><NuxtLink to="/forgot-password">Request a new link</NuxtLink></Button>
 *   </AuthStatus>
 */
import { CircleAlertIcon, CircleCheckIcon, LoaderCircleIcon, MailIcon } from '@lucide/vue'
import { CardContent, CardHeader } from '@/components/ui/card'

const props = withDefaults(
  defineProps<{ title: string; description?: string; tone?: 'success' | 'error' | 'mail' | 'loading' }>(),
  { description: undefined, tone: 'success' },
)
defineSlots<{ default?(): unknown; description?(): unknown }>()

const icon = computed(
  () => ({ success: CircleCheckIcon, error: CircleAlertIcon, mail: MailIcon, loading: LoaderCircleIcon })[props.tone],
)
</script>

<template>
  <CardHeader class="items-center gap-3 text-center" :data-testid="`auth-status-${tone}`">
    <span
      class="mx-auto flex size-12 items-center justify-center rounded-full ring-1"
      :class="
        tone === 'error'
          ? 'bg-destructive/10 text-destructive ring-destructive/20'
          : 'bg-primary/10 text-primary ring-primary/20'
      "
    >
      <component
        :is="icon"
        class="size-6"
        :class="{ 'motion-safe:animate-spin': tone === 'loading' }"
        aria-hidden="true"
      />
    </span>
    <h1
      class="text-xl font-semibold tracking-tight text-balance"
      :aria-live="tone === 'loading' ? undefined : 'polite'"
    >
      {{ title }}
    </h1>
    <p v-if="description || $slots.description" class="text-sm text-pretty text-muted-foreground">
      <slot name="description">{{ description }}</slot>
    </p>
  </CardHeader>
  <CardContent v-if="$slots.default" class="flex flex-col gap-2">
    <slot />
  </CardContent>
</template>
