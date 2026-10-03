<script setup lang="ts">
/**
 * /admin/rooms: every room with live participant counts (refreshed every 15 s), meeting history per room, "End
 * meeting" and "Delete". Metadata only: admins never see keys, links with keys, chat or media.
 */
import { RefreshCwIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { AdminRoom } from '#shared/schemas/admin'
import { Button } from '@/components/ui/button'
import AppPageHeader from '@/components/app/AppPageHeader.vue'
import AdminListState from '@/components/admin/AdminListState.vue'
import AdminPager, { useAdminList } from '@/components/admin/AdminPager.vue'
import AdminSearch from '@/components/admin/AdminSearch.vue'
import { adminErrorText } from '@/components/admin/AdminTime.vue'
import ConfirmDialog from '@/components/admin/ConfirmDialog.vue'
import RoomsTable from '@/components/admin/RoomsTable.vue'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Rooms · Admin' })

const REFRESH_MS = 15_000

const api = useApi()
const search = ref('')
const list = useAdminList<AdminRoom>('/api/admin/rooms', () => ({ q: search.value || undefined }))
const { data, state, errorText, page, pageSize } = list

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') void list.load({ quiet: true })
  }, REFRESH_MS)
})
onBeforeUnmount(() => clearInterval(timer))

type Action = 'end' | 'delete'
const action = ref<Action>('end')
const target = shallowRef<AdminRoom | null>(null)
const confirmOpen = ref(false)
const pending = ref(false)
const confirmError = ref<string | null>(null)

const copy = computed(() => {
  const name = target.value?.name ?? 'this room'
  return action.value === 'end'
    ? {
        title: 'End this meeting?',
        description: `Everyone in ${name} is disconnected and people waiting are turned away. The room stays.`,
        confirm: 'End meeting',
      }
    : {
        title: 'Delete this room?',
        description: `${name} is deleted and its link stops working. A meeting in progress ends at once.`,
        confirm: 'Delete room',
      }
})

function ask(next: Action, room: AdminRoom) {
  action.value = next
  target.value = room
  confirmError.value = null
  confirmOpen.value = true
}

async function confirm() {
  const room = target.value
  if (!room) return
  pending.value = true
  confirmError.value = null
  try {
    const path = `/api/admin/rooms/${encodeURIComponent(room.id)}`
    if (action.value === 'end') {
      await api(`${path}/end`, { method: 'POST' })
      toast.success('Meeting ended')
    } else {
      await api(path, { method: 'DELETE' })
      toast.success('Room deleted')
    }
    confirmOpen.value = false
    await list.reload({ removed: action.value === 'delete' })
  } catch (error) {
    confirmError.value = adminErrorText(error)
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div>
    <AppPageHeader title="Rooms" description="Every room on this server. Live rooms come first.">
      <template #actions>
        <Button variant="outline" data-testid="refresh-rooms" @click="list.load({ quiet: true })">
          <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
          Refresh
        </Button>
      </template>
    </AppPageHeader>

    <div class="mb-4">
      <AdminSearch v-model="search" label="Search rooms" placeholder="Room, link, owner or email" />
    </div>

    <AdminListState
      :state="state"
      :data="data"
      :error-text="errorText"
      label="rooms"
      :empty="search ? 'No rooms match this search.' : 'No rooms yet.'"
      @retry="list.load()"
    >
      <div class="rounded-lg border bg-card">
        <RoomsTable :items="data!.items" @end="ask('end', $event)" @delete="ask('delete', $event)" />
      </div>
      <AdminPager :total="data!.total" :page="page" :page-size="pageSize" noun="room" @update:page="list.setPage" />
    </AdminListState>

    <ConfirmDialog
      v-model:open="confirmOpen"
      :title="copy.title"
      :description="copy.description"
      :confirm-label="copy.confirm"
      :pending="pending"
      :error="confirmError"
      @confirm="confirm"
    />
  </div>
</template>
