<script setup lang="ts">
/**
 * Full-width states of the recording pages: nothing recorded yet, signed out (until the Stage 02 route middleware
 * exists, the pages handle 401/403 from the API themselves), no access, not found, or a failed request.
 */
import { AlertCircleIcon, FilmIcon, LockIcon, LogInIcon, SearchXIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

const props = defineProps<{
  kind: 'empty' | 'signin' | 'forbidden' | 'not-found' | 'error'
  /** Where "Sign in" returns to. */
  next?: string
  /** Error text (English, from the API client). */
  message?: string
}>()
const emit = defineEmits<{ retry: [] }>()

const copy = computed(() => {
  switch (props.kind) {
    case 'empty':
      return {
        icon: FilmIcon,
        title: 'No recordings yet',
        description: 'Recordings you make in a meeting, and recordings of rooms you own, appear here.',
      }
    case 'signin':
      return {
        icon: LogInIcon,
        title: 'Sign in to see recordings',
        description: 'Recordings are only available to signed-in users.',
      }
    case 'forbidden':
      return { icon: LockIcon, title: 'You do not have access', description: 'Only administrators can open this page.' }
    case 'not-found':
      return {
        icon: SearchXIcon,
        title: 'Recording not found',
        description: 'It may have been deleted, or it belongs to someone else.',
      }
    default:
      return {
        icon: AlertCircleIcon,
        title: 'Recordings could not be loaded',
        description: props.message ?? 'Something went wrong. Try again in a moment.',
      }
  }
})
</script>

<template>
  <Empty class="border" :data-testid="`recordings-${kind}`">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <component :is="copy.icon" aria-hidden="true" />
      </EmptyMedia>
      <EmptyTitle>{{ copy.title }}</EmptyTitle>
      <EmptyDescription>{{ copy.description }}</EmptyDescription>
    </EmptyHeader>
    <EmptyContent v-if="kind !== 'empty'">
      <Button v-if="kind === 'signin'" as-child>
        <NuxtLink :to="{ path: '/login', query: next ? { next } : {} }">Sign in</NuxtLink>
      </Button>
      <Button v-else-if="kind === 'error'" variant="outline" @click="emit('retry')">Try again</Button>
      <Button v-else variant="outline" as-child>
        <NuxtLink to="/recordings">Back to recordings</NuxtLink>
      </Button>
    </EmptyContent>
  </Empty>
</template>
