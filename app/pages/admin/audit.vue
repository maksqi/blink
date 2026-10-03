<script setup lang="ts">
/**
 * /admin/audit: the audit log, newest first. Filters: target (type or id), action domain, and the acting account
 * (click an actor in the table). Details are plain text.
 */
import { XIcon } from '@lucide/vue'
import type { AuditEntry } from '#shared/schemas/admin'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import AppPageHeader from '@/components/app/AppPageHeader.vue'
import AdminListState from '@/components/admin/AdminListState.vue'
import AdminPager, { useAdminList } from '@/components/admin/AdminPager.vue'
import AdminSearch from '@/components/admin/AdminSearch.vue'
import AuditTable from '@/components/admin/AuditTable.vue'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Audit log · Admin' })

const DOMAINS = [
  { value: 'all', label: 'All actions' },
  { value: 'admin', label: 'Admin actions' },
  { value: 'auth', label: 'Sign-in and accounts' },
  { value: 'user', label: 'Profiles' },
  { value: 'room', label: 'Rooms' },
  { value: 'call', label: 'Meeting moderation' },
  { value: 'recording', label: 'Recordings' },
  { value: 'system', label: 'System' },
] as const

const search = ref('')
const domain = ref<string>('all')
const actor = shallowRef<{ id: string; name: string | null } | null>(null)
const list = useAdminList<AuditEntry>(
  '/api/admin/audit',
  () => ({
    q: search.value || undefined,
    action: domain.value === 'all' ? undefined : domain.value,
    actorUserId: actor.value?.id,
  }),
  { pageSize: 50 },
)
const { data, state, errorText, page, pageSize } = list

function filterActor(id: string, name: string | null) {
  actor.value = { id, name }
}
</script>

<template>
  <div>
    <AppPageHeader
      title="Audit log"
      description="Admin actions, sign-ins, moderation and security events. Entries are kept for the configured retention."
    />

    <div class="mb-4 flex flex-wrap items-center gap-2">
      <AdminSearch v-model="search" label="Search by target" placeholder="Target type or id" />
      <Select v-model="domain">
        <SelectTrigger class="w-full sm:w-52" aria-label="Filter by action" data-testid="filter-action">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="option in DOMAINS" :key="option.value" :value="option.value">{{ option.label }}</SelectItem>
        </SelectContent>
      </Select>
      <Badge v-if="actor" variant="secondary" class="h-8 gap-1.5 pr-1 text-sm" data-testid="actor-filter">
        By {{ actor.name ?? 'one account' }}
        <button
          type="button"
          class="rounded-full p-0.5 hover:bg-background/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label="Show entries by everyone"
          @click="actor = null"
        >
          <XIcon class="size-3.5" aria-hidden="true" />
        </button>
      </Badge>
    </div>

    <AdminListState
      :state="state"
      :data="data"
      :error-text="errorText"
      label="audit entries"
      empty="No entries match these filters."
      @retry="list.load()"
    >
      <div class="rounded-lg border bg-card">
        <AuditTable :items="data!.items" @actor="filterActor" />
      </div>
      <AdminPager
        :total="data!.total"
        :page="page"
        :page-size="pageSize"
        noun="entry"
        plural="entries"
        @update:page="list.setPage"
      />
    </AdminListState>
  </div>
</template>
