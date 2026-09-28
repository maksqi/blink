<script setup lang="ts">
/** Form-level message (errors by default). Renders nothing without a message; announced by screen readers. */
import { CircleAlertIcon, CircleCheckIcon, InfoIcon } from '@lucide/vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

const props = withDefaults(
  defineProps<{ message?: string | null; title?: string; tone?: 'error' | 'info' | 'success' }>(),
  { message: null, title: undefined, tone: 'error' },
)

const icon = computed(() =>
  props.tone === 'error' ? CircleAlertIcon : props.tone === 'success' ? CircleCheckIcon : InfoIcon,
)
</script>

<template>
  <Alert
    v-if="message"
    :variant="tone === 'error' ? 'destructive' : 'default'"
    :class="tone === 'success' ? 'border-primary/30 bg-primary/5' : undefined"
    data-testid="form-alert"
  >
    <component :is="icon" aria-hidden="true" />
    <AlertTitle v-if="title">{{ title }}</AlertTitle>
    <AlertDescription>{{ message }}</AlertDescription>
  </Alert>
</template>
