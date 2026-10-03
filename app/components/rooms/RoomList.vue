<script setup lang="ts">
/**
 * The rooms the user owns or co-hosts (`GET /api/rooms`), newest activity first, paginated through `?page=`. Loaded on
 * the client: whether this device holds a room's key is only known in the browser. Live rooms refresh every 15 s.
 */
import { DoorOpenIcon, PlusIcon } from '@lucide/vue'
import type { Paginated } from '#shared/schemas/common'
import type { RoomSummary } from '#shared/schemas/rooms'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipProvider } from '@/components/ui/tooltip'
import FormAlert from '@/components/auth/FormAlert.vue'
import { buildRoomLink } from '~/lib/e2ee/fragment'
import { useKeyVault } from '~/composables/rooms/useKeyVault'
import { useLinkSharing } from '~/composables/rooms/useLinkSharing'
import { useRoomsApi } from '~/composables/rooms/useRoomsApi'
import { authErrorText } from '~/composables/useAuth'
import RoomListItem from './RoomListItem.vue'

const props = defineProps<{ publicUrl: string }>()
const emit = defineEmits<{ create: [] }>()

const PAGE_SIZE = 20
const POLL_MS = 15_000

const rooms = useRoomsApi()
const vault = useKeyVault()
const sharing = useLinkSharing()
const route = useRoute()
const router = useRouter()

const page = computed(() => {
  const value = Number(route.query.page)
  return Number.isInteger(value) && value > 0 ? value : 1
})
const data = shallowRef<Paginated<RoomSummary> | null>(null)
const error = ref<string | null>(null)
const now = ref(Date.now())

let timer: ReturnType<typeof setTimeout> | undefined
let generation = 0

async function load(quiet = false) {
  const current = ++generation
  clearTimeout(timer)
  try {
    const result = await rooms.list({ page: page.value, pageSize: PAGE_SIZE })
    if (current !== generation) return
    data.value = result
    error.value = null
    now.value = Date.now()
    if (result.items.some((room) => room.live)) timer = setTimeout(() => void load(true), POLL_MS)
  } catch (cause) {
    if (current !== generation) return
    if (!quiet || !data.value) error.value = authErrorText(cause)
  }
}

function hasKey(room: RoomSummary): boolean {
  return vault.get(room.id) !== null
}

function copyLink(room: RoomSummary) {
  const entry = vault.get(room.id)
  if (!entry) return
  void sharing.copy(buildRoomLink(props.publicUrl || window.location.origin, room.slug, entry.key), 'Host link copied')
}

function setPage(value: number) {
  const query = { ...route.query }
  if (value > 1) query.page = String(value)
  else delete query.page
  void router.replace({ query })
}

onMounted(() => void load())
onBeforeUnmount(() => {
  generation++
  clearTimeout(timer)
})
watch(page, () => void load())

defineExpose({ reload: () => load(true) })
</script>

<template>
  <TooltipProvider>
    <section aria-labelledby="rooms-title" data-testid="room-list">
      <h2 id="rooms-title" class="mb-3 text-sm font-medium text-muted-foreground">Your rooms</h2>

      <div v-if="!data && !error" class="space-y-3" aria-busy="true" aria-label="Loading rooms">
        <Skeleton v-for="i in 3" :key="i" class="h-[4.5rem] w-full rounded-md" />
      </div>

      <div v-else-if="error && !data" class="flex flex-col items-start gap-3">
        <FormAlert :message="error" title="Rooms could not be loaded" />
        <Button variant="outline" size="sm" @click="load()">Try again</Button>
      </div>

      <Empty v-else-if="data && data.total === 0" class="border bg-card" data-testid="rooms-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <DoorOpenIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No rooms yet</EmptyTitle>
          <EmptyDescription>
            A room keeps the same link for every meeting. Start an instant meeting when you only need one call.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" @click="emit('create')">
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
            New room
          </Button>
        </EmptyContent>
      </Empty>

      <template v-else-if="data">
        <ul class="flex flex-col gap-2.5">
          <li v-for="room in data.items" :key="room.id">
            <RoomListItem :room="room" :has-key="hasKey(room)" :now="now" @copy-link="copyLink" />
          </li>
        </ul>
        <div class="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span aria-live="polite">{{ data.total === 1 ? '1 room' : `${data.total} rooms` }}</span>
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
    </section>
  </TooltipProvider>
</template>
