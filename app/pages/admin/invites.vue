<script setup lang="ts">
/** /admin/invites: account invites (newest first, searchable by email), "Create invite" (link shown once), revoke. */
import { MailPlusIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { AdminInvite } from '#shared/schemas/admin'
import { Button } from '@/components/ui/button'
import AppPageHeader from '@/components/app/AppPageHeader.vue'
import AdminListState from '@/components/admin/AdminListState.vue'
import AdminPager, { useAdminList } from '@/components/admin/AdminPager.vue'
import AdminSearch from '@/components/admin/AdminSearch.vue'
import { adminErrorText } from '@/components/admin/AdminTime.vue'
import ConfirmDialog from '@/components/admin/ConfirmDialog.vue'
import CreateInviteDialog from '@/components/admin/CreateInviteDialog.vue'
import InvitesTable from '@/components/admin/InvitesTable.vue'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Invites · Admin' })

const api = useApi()
const requestUrl = useRequestURL()
const { data: config } = await useAuthPageConfig()
const smtpEnabled = computed(() => config.value?.smtpEnabled ?? false)
const publicUrl = computed(() => config.value?.publicUrl ?? requestUrl.origin)

const search = ref('')
const list = useAdminList<AdminInvite>('/api/admin/invites', () => ({ q: search.value || undefined }))
const { data, state, errorText, page, pageSize } = list
// Expiry is judged at load time, not continuously.
const now = ref(Date.now())
watch(data, () => (now.value = Date.now()))

const createOpen = ref(false)
const target = shallowRef<AdminInvite | null>(null)
const revokeOpen = ref(false)
const revoking = ref(false)
const revokeError = ref<string | null>(null)

function askRevoke(invite: AdminInvite) {
  target.value = invite
  revokeError.value = null
  revokeOpen.value = true
}

async function revoke() {
  const invite = target.value
  if (!invite) return
  revoking.value = true
  revokeError.value = null
  try {
    await api(`/api/admin/invites/${encodeURIComponent(invite.id)}`, { method: 'DELETE' })
    toast.success('Invite revoked')
    revokeOpen.value = false
    await list.reload()
  } catch (error) {
    revokeError.value = adminErrorText(error)
  } finally {
    revoking.value = false
  }
}
</script>

<template>
  <div>
    <AppPageHeader title="Invites" description="Invite links let people create an account while registration is closed.">
      <template #actions>
        <Button data-testid="create-invite" @click="createOpen = true">
          <MailPlusIcon data-icon="inline-start" aria-hidden="true" />
          Create invite
        </Button>
      </template>
    </AppPageHeader>

    <div class="mb-4">
      <AdminSearch v-model="search" label="Search invites" placeholder="Email" />
    </div>

    <AdminListState
      :state="state"
      :data="data"
      :error-text="errorText"
      label="invites"
      :empty="search ? 'No invites match this search.' : 'No invites yet. Create one to let someone sign up.'"
      @retry="list.load()"
    >
      <div class="rounded-lg border bg-card">
        <InvitesTable :items="data!.items" :now="now" @revoke="askRevoke" />
      </div>
      <AdminPager :total="data!.total" :page="page" :page-size="pageSize" noun="invite" @update:page="list.setPage" />
    </AdminListState>

    <CreateInviteDialog
      v-model:open="createOpen"
      :smtp-enabled="smtpEnabled"
      :public-url="publicUrl"
      @created="list.reload()"
    />
    <ConfirmDialog
      v-model:open="revokeOpen"
      title="Revoke this invite?"
      :description="`The link for ${target?.email ?? 'anyone with the link'} stops working at once.`"
      confirm-label="Revoke invite"
      :pending="revoking"
      :error="revokeError"
      @confirm="revoke"
    />
  </div>
</template>
