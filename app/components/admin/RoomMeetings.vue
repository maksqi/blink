<script setup lang="ts">
/** Meeting history of one room (start, end, duration, peak), loaded when its row is expanded. Metadata only. */
import type { Paginated } from '#shared/schemas/common'
import type { MeetingSummary } from '#shared/schemas/rooms'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import AdminTime, { adminErrorText } from './AdminTime.vue'

const props = defineProps<{ roomId: string }>()

const PAGE_SIZE = 10
const api = useApi()
const items = ref<MeetingSummary[]>([])
const total = ref(0)
const page = ref(0)
const loading = ref(false)
const error = ref<string | null>(null)

async function loadMore() {
  loading.value = true
  error.value = null
  try {
    const next = page.value + 1
    const result = await api<Paginated<MeetingSummary>>(
      `/api/admin/rooms/${encodeURIComponent(props.roomId)}/meetings`,
      { query: { page: next, pageSize: PAGE_SIZE } },
    )
    items.value = [...items.value, ...result.items]
    total.value = result.total
    page.value = next
  } catch (caught) {
    error.value = adminErrorText(caught)
  } finally {
    loading.value = false
  }
}

function duration(meeting: MeetingSummary): string {
  if (!meeting.endedAt) return 'In progress'
  const minutes = Math.max(0, Math.round((Date.parse(meeting.endedAt) - Date.parse(meeting.startedAt)) / 60_000))
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

onMounted(() => void loadMore())
</script>

<template>
  <div class="py-2" data-testid="room-meetings">
    <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
    <div v-else-if="loading && !items.length" class="space-y-2" aria-busy="true" aria-label="Loading meetings">
      <Skeleton v-for="i in 2" :key="i" class="h-6 w-full max-w-md" />
    </div>
    <p v-else-if="!items.length" class="text-sm text-muted-foreground">No meetings yet.</p>
    <template v-else>
      <ul class="divide-y rounded-md border bg-background text-sm">
        <li
          v-for="meeting in items"
          :key="meeting.id"
          class="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2"
          data-testid="meeting-item"
        >
          <span class="min-w-40"><AdminTime :iso="meeting.startedAt" /></span>
          <Badge v-if="!meeting.endedAt" variant="default">Live</Badge>
          <span v-else class="text-muted-foreground">{{ duration(meeting) }}</span>
          <span class="text-muted-foreground">
            Peak {{ meeting.peakParticipants }} {{ meeting.peakParticipants === 1 ? 'person' : 'people' }}
          </span>
        </li>
      </ul>
      <div class="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        <span>{{ items.length }} of {{ total }} meetings</span>
        <Button v-if="items.length < total" variant="link" size="sm" class="h-auto p-0" :disabled="loading" @click="loadMore">
          Show more
        </Button>
      </div>
    </template>
  </div>
</template>
