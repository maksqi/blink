<script setup lang="ts">
/** Past and current meetings of a room (`GET /api/rooms/:id/meetings`): start, duration and peak attendance. */
import type { Paginated } from '#shared/schemas/common'
import type { MeetingSummary } from '#shared/schemas/rooms'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import FormAlert from '@/components/auth/FormAlert.vue'
import { formatDateTime, meetingDuration } from '~/lib/join/format'
import { useRoomsApi } from '~/composables/rooms/useRoomsApi'
import { authErrorText } from '~/composables/useAuth'

const props = defineProps<{ roomId: string }>()

const PAGE_SIZE = 10
const rooms = useRoomsApi()
const page = ref(1)
const data = shallowRef<Paginated<MeetingSummary> | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)
const now = ref(Date.now())
const lastPage = computed(() => (data.value ? Math.max(1, Math.ceil(data.value.total / PAGE_SIZE)) : 1))

async function load() {
  loading.value = true
  try {
    data.value = await rooms.meetings(props.roomId, { page: page.value, pageSize: PAGE_SIZE })
    now.value = Date.now()
    error.value = null
  } catch (cause) {
    error.value = authErrorText(cause)
  } finally {
    loading.value = false
  }
}

onMounted(() => void load())
watch(page, () => void load())
defineExpose({ reload: load })
</script>

<template>
  <div data-testid="meeting-history">
    <div v-if="!data && !error" class="space-y-2" aria-busy="true" aria-label="Loading meetings">
      <Skeleton v-for="i in 3" :key="i" class="h-9 w-full" />
    </div>
    <FormAlert v-else-if="error && !data" :message="error" title="Meetings could not be loaded" />
    <p v-else-if="data && data.total === 0" class="text-sm text-muted-foreground">No meetings in this room yet.</p>
    <template v-else-if="data">
      <div class="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Started</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead class="text-right">Peak people</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="meeting in data.items" :key="meeting.id">
              <TableCell class="whitespace-nowrap">{{ formatDateTime(meeting.startedAt) }}</TableCell>
              <TableCell class="whitespace-nowrap">
                {{ meetingDuration(meeting.startedAt, meeting.endedAt, now) }}
                <Badge v-if="!meeting.endedAt" variant="secondary" class="ml-2 bg-primary/15 text-primary">Live</Badge>
              </TableCell>
              <TableCell class="text-right tabular-nums">{{ meeting.peakParticipants }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <div v-if="lastPage > 1" class="mt-3 flex items-center justify-end gap-2 text-sm text-muted-foreground">
        <span class="tabular-nums">Page {{ page }} of {{ lastPage }}</span>
        <Button variant="outline" size="sm" :disabled="page <= 1 || loading" @click="page--">Newer</Button>
        <Button variant="outline" size="sm" :disabled="page >= lastPage || loading" @click="page++">Older</Button>
      </div>
    </template>
  </div>
</template>
