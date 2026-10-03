<script setup lang="ts">
/**
 * /admin/users: every account with search and role/status filters; "Create user" (temporary password shown once);
 * "Manage" opens the detail sheet (role, disable, reset password, sign out everywhere, delete).
 */
import { UserPlusIcon } from '@lucide/vue'
import type { AdminUser } from '#shared/schemas/admin'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import AppPageHeader from '@/components/app/AppPageHeader.vue'
import AdminListState from '@/components/admin/AdminListState.vue'
import AdminPager, { useAdminList } from '@/components/admin/AdminPager.vue'
import AdminSearch from '@/components/admin/AdminSearch.vue'
import CreateUserDialog from '@/components/admin/CreateUserDialog.vue'
import UserSheet from '@/components/admin/UserSheet.vue'
import UsersTable from '@/components/admin/UsersTable.vue'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Users · Admin' })

const { user: me } = useAuth()
const { data: config } = await useAuthPageConfig()
const smtpEnabled = computed(() => config.value?.smtpEnabled ?? false)

const search = ref('')
const role = ref<'all' | 'admin' | 'user'>('all')
const status = ref<'all' | 'active' | 'disabled'>('all')
const list = useAdminList<AdminUser>('/api/admin/users', () => ({
  q: search.value || undefined,
  role: role.value === 'all' ? undefined : role.value,
  status: status.value === 'all' ? undefined : status.value,
}))
const { data, state, errorText, page, pageSize } = list

const createOpen = ref(false)
const sheetOpen = ref(false)
const selected = shallowRef<AdminUser | null>(null)

function select(user: AdminUser) {
  selected.value = user
  sheetOpen.value = true
}

function onUpdated(user: AdminUser) {
  if (data.value) {
    data.value = { ...data.value, items: data.value.items.map((item) => (item.id === user.id ? user : item)) }
  }
}
</script>

<template>
  <div>
    <AppPageHeader title="Users" description="Create accounts, change roles, and disable or remove access.">
      <template #actions>
        <Button data-testid="create-user" @click="createOpen = true">
          <UserPlusIcon data-icon="inline-start" aria-hidden="true" />
          Create user
        </Button>
      </template>
    </AppPageHeader>

    <div class="mb-4 flex flex-wrap items-center gap-2">
      <AdminSearch v-model="search" label="Search users" placeholder="Name or email" />
      <Select v-model="role">
        <SelectTrigger class="w-full sm:w-36" aria-label="Filter by role" data-testid="filter-role">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All roles</SelectItem>
          <SelectItem value="admin">Admins</SelectItem>
          <SelectItem value="user">Users</SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="status">
        <SelectTrigger class="w-full sm:w-36" aria-label="Filter by status" data-testid="filter-status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any status</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="disabled">Disabled</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <AdminListState
      :state="state"
      :data="data"
      :error-text="errorText"
      label="users"
      empty="No accounts match these filters."
      @retry="list.load()"
    >
      <div class="rounded-lg border bg-card">
        <UsersTable :items="data!.items" :current-user-id="me?.id ?? null" @select="select" />
      </div>
      <AdminPager :total="data!.total" :page="page" :page-size="pageSize" noun="account" @update:page="list.setPage" />
    </AdminListState>

    <CreateUserDialog v-model:open="createOpen" :smtp-enabled="smtpEnabled" @created="list.reload()" />
    <UserSheet
      v-model:open="sheetOpen"
      :user="selected"
      :current-user-id="me?.id ?? null"
      :smtp-enabled="smtpEnabled"
      @updated="onUpdated"
      @deleted="list.reload({ removed: true })"
    />
  </div>
</template>
