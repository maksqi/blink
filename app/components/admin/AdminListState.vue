<script setup lang="ts">
/**
 * Loading, error and empty states of an admin list; renders the default slot once there are rows.
 *   <AdminListState :list="list" label="users" empty="No users match these filters.">…table…</AdminListState>
 */
import { RefreshCwIcon } from '@lucide/vue'
import type { Paginated } from '#shared/schemas/common'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import FormAlert from '@/components/auth/FormAlert.vue'

defineProps<{
  state: 'loading' | 'ready' | 'error'
  data: Paginated<unknown> | null
  errorText: string | null
  /** Plural noun for screen readers, e.g. "users". */
  label: string
  empty: string
}>()
const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div v-if="state === 'loading'" class="space-y-3" aria-busy="true" :aria-label="`Loading ${label}`">
    <Skeleton v-for="i in 4" :key="i" class="h-12 w-full" />
  </div>
  <div v-else-if="state === 'error'" class="flex flex-col items-start gap-3">
    <FormAlert :message="errorText" :title="`The ${label} could not be loaded`" />
    <Button variant="outline" @click="emit('retry')">
      <RefreshCwIcon aria-hidden="true" />
      Try again
    </Button>
  </div>
  <p
    v-else-if="data && data.total === 0"
    class="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
    data-testid="admin-list-empty"
  >
    {{ empty }}
  </p>
  <slot v-else-if="data" />
</template>
