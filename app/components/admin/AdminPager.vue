<script lang="ts">
/**
 * `<AdminPager :list="list" noun="user" />`: the item count and page links under an admin table. This SFC's plain
 * <script> block also holds `useAdminList(endpoint, filters)`, the loader every admin list shares:
 * - loads on the client (times render in the viewer's time zone) with the `?page=` of the URL and the given filters;
 * - a filter change goes back to page 1; stale answers of earlier requests are dropped;
 * - `reload({ removed })` refreshes quietly after a change; `removed: true` steps back a page when the only row of a
 *   later page went away.
 */
import type { ComputedRef, MaybeRefOrGetter, Ref } from 'vue'
import type { Paginated } from '#shared/schemas/common'
import { adminErrorText, pageQuery } from './AdminTime.vue'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'

export const ADMIN_PAGE_SIZE = 25

export interface AdminList<T> {
  data: Ref<Paginated<T> | null>
  state: Ref<'loading' | 'ready' | 'error'>
  errorText: Ref<string | null>
  page: ComputedRef<number>
  pageSize: number
  setPage(value: number): void
  load(options?: { quiet?: boolean }): Promise<void>
  reload(options?: { removed?: boolean }): Promise<void>
}

export function useAdminList<T>(
  endpoint: MaybeRefOrGetter<string>,
  filters: () => Record<string, string | number | undefined> = () => ({}),
  options: { pageSize?: number } = {},
): AdminList<T> {
  const api = useApi()
  const route = useRoute()
  const router = useRouter()
  const pageSize = options.pageSize ?? ADMIN_PAGE_SIZE
  const page = computed(() => pageQuery(route))
  const data = shallowRef<Paginated<T> | null>(null)
  const state = ref<'loading' | 'ready' | 'error'>('loading')
  const errorText = ref<string | null>(null)
  let generation = 0

  function setPage(value: number) {
    const query = { ...route.query }
    if (value > 1) query.page = String(value)
    else delete query.page
    void router.replace({ query })
  }

  async function load(loadOptions: { quiet?: boolean } = {}) {
    const current = ++generation
    if (!loadOptions.quiet) state.value = 'loading'
    const query: Record<string, string | number> = { page: page.value, pageSize }
    for (const [key, value] of Object.entries(filters())) if (value !== undefined && value !== '') query[key] = value
    try {
      const result = await api<Paginated<T>>(toValue(endpoint), { query })
      if (current !== generation) return
      data.value = result
      state.value = 'ready'
      errorText.value = null
    } catch (error) {
      if (current !== generation) return
      errorText.value = adminErrorText(error)
      if (!loadOptions.quiet || !data.value) state.value = 'error'
    }
  }

  async function reload(reloadOptions: { removed?: boolean } = {}) {
    if (reloadOptions.removed && data.value?.items.length === 1 && page.value > 1) {
      setPage(page.value - 1)
      return
    }
    await load({ quiet: true })
  }

  onMounted(() => void load())
  onBeforeUnmount(() => {
    generation++
  })
  watch(page, () => void load())
  watch(
    () => JSON.stringify(filters()),
    () => {
      if (page.value !== 1) setPage(1)
      else void load()
    },
  )

  return { data, state, errorText, page, pageSize, setPage, load, reload }
}
</script>

<script setup lang="ts">
const props = defineProps<{ total: number; page: number; pageSize: number; noun: string; plural?: string }>()
const emit = defineEmits<{ 'update:page': [page: number] }>()

const label = computed(() =>
  props.total === 1 ? `1 ${props.noun}` : `${props.total} ${props.plural ?? `${props.noun}s`}`,
)
</script>

<template>
  <div class="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
    <span aria-live="polite" data-testid="admin-list-count">{{ label }}</span>
    <Pagination
      v-if="total > pageSize"
      v-slot="{ page: current }"
      :page="page"
      :total="total"
      :items-per-page="pageSize"
      :sibling-count="1"
      class="mx-0 w-auto"
      @update:page="emit('update:page', $event)"
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
