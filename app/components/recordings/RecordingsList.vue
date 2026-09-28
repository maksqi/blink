<script setup lang="ts">
/**
 * Loads, paginates and polls a recording list (`/api/recordings` or `/api/admin/recordings`) and runs the delete flow.
 * - Polls every 5 s while a row is `recording` or `processing`.
 * - The page number lives in the URL (`?page=`). 401 and 403 answers turn into sign-in and no-access notices, because
 *   the Stage 02 route middleware may not exist yet.
 */
import { toast } from 'vue-sonner'
import type { Paginated } from '#shared/schemas/common'
import type { RecordingSummary } from '#shared/schemas/recordings'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '~/composables/useApi'
import DeleteRecordingDialog from './DeleteRecordingDialog.vue'
import { isBusy } from './RecordingMeta.vue'
import RecordingsNotice from './RecordingsNotice.vue'
import RecordingsTable from './RecordingsTable.vue'

const props = defineProps<{
  endpoint: '/api/recordings' | '/api/admin/recordings'
  admin?: boolean
  search?: string
}>()

const PAGE_SIZE = 25
const POLL_MS = 5_000

const api = useApi()
const route = useRoute()
const router = useRouter()

const page = computed(() => {
  const value = Number(route.query.page)
  return Number.isInteger(value) && value > 0 ? value : 1
})
const data = shallowRef<Paginated<RecordingSummary> | null>(null)
const state = ref<'loading' | 'ready' | 'signin' | 'forbidden' | 'error'>('loading')
const errorMessage = ref<string>()

let timer: ReturnType<typeof setTimeout> | undefined
let generation = 0

function schedulePoll() {
  clearTimeout(timer)
  timer = setTimeout(() => void load({ quiet: true }), POLL_MS)
}

async function load(options: { quiet?: boolean } = {}) {
  const current = ++generation
  clearTimeout(timer)
  if (!options.quiet && !data.value) state.value = 'loading'
  try {
    const result = await api<Paginated<RecordingSummary>>(props.endpoint, {
      query: { page: page.value, pageSize: PAGE_SIZE, ...(props.search ? { q: props.search } : {}) },
    })
    if (current !== generation) return
    data.value = result
    state.value = 'ready'
    if (result.items.some(isBusy)) schedulePoll()
  } catch (error) {
    if (current !== generation) return
    if (error instanceof ApiError && error.status === 401) state.value = 'signin'
    else if (error instanceof ApiError && error.status === 403) state.value = 'forbidden'
    else if (options.quiet) schedulePoll()
    else {
      state.value = 'error'
      errorMessage.value = error instanceof ApiError ? error.message : undefined
    }
  }
}

onMounted(() => void load())
onBeforeUnmount(() => {
  generation++
  clearTimeout(timer)
})
watch([page, () => props.search], () => void load())

function setPage(value: number) {
  const query = { ...route.query }
  if (value > 1) query.page = String(value)
  else delete query.page
  void router.replace({ query })
}

// When the search changes, start again on the first page.
watch(
  () => props.search,
  () => {
    if (page.value !== 1) setPage(1)
  },
)

const dialogOpen = ref(false)
const target = shallowRef<RecordingSummary | null>(null)
const deleting = ref(false)

function askDelete(recording: RecordingSummary) {
  target.value = recording
  dialogOpen.value = true
}

async function confirmDelete() {
  const recording = target.value
  if (!recording) return
  deleting.value = true
  try {
    const base = props.admin ? '/api/admin/recordings' : '/api/recordings'
    await api(`${base}/${encodeURIComponent(recording.id)}`, { method: 'DELETE' })
    toast.success('Recording deleted')
    dialogOpen.value = false
    if (data.value && data.value.items.length === 1 && page.value > 1) setPage(page.value - 1)
    else await load({ quiet: true })
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : 'The recording could not be deleted. Try again.')
  } finally {
    deleting.value = false
  }
}

const next = computed(() => route.path)
</script>

<template>
  <div>
    <div v-if="state === 'loading'" class="space-y-3" aria-busy="true" aria-label="Loading recordings">
      <Skeleton v-for="i in 4" :key="i" class="h-12 w-full" />
    </div>
    <RecordingsNotice v-else-if="state === 'signin'" kind="signin" :next="next" />
    <RecordingsNotice v-else-if="state === 'forbidden'" kind="forbidden" />
    <RecordingsNotice v-else-if="state === 'error'" kind="error" :message="errorMessage" @retry="load()" />
    <template v-else-if="data">
      <RecordingsNotice v-if="data.total === 0 && !search" kind="empty" />
      <p
        v-else-if="data.total === 0"
        class="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
      >
        No recordings match this search.
      </p>
      <template v-else>
        <div class="rounded-lg border bg-card">
          <RecordingsTable :items="data.items" :admin="admin" @delete="askDelete" />
        </div>
        <div class="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span aria-live="polite">{{ data.total === 1 ? '1 recording' : `${data.total} recordings` }}</span>
          <Pagination
            v-if="data.total > PAGE_SIZE"
            v-slot="{ page: current }"
            :page="page"
            :total="data.total"
            :items-per-page="PAGE_SIZE"
            :sibling-count="1"
            class="mx-0 w-auto"
            @update:page="setPage"
          >
            <PaginationContent v-slot="{ items }">
              <PaginationPrevious />
              <template v-for="(item, index) in items" :key="index">
                <PaginationItem v-if="item.type === 'page'" :value="item.value" :is-active="item.value === current">
                  {{ item.value }}
                </PaginationItem>
                <PaginationEllipsis v-else :index="index" />
              </template>
              <PaginationNext />
            </PaginationContent>
          </Pagination>
        </div>
      </template>
    </template>
    <DeleteRecordingDialog v-model:open="dialogOpen" :recording="target" :pending="deleting" @confirm="confirmDelete" />
  </div>
</template>
