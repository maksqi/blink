<script setup lang="ts">
/** Gallery view: up to 5×5 tiles per page (6 on phones, with paging). Tiles on other pages are not rendered. */
import { ChevronLeftIcon, ChevronRightIcon } from '@lucide/vue'
import { useElementSize } from '@vueuse/core'
import { computed, shallowRef, watch } from 'vue'
import { cn } from '@/lib/utils'
import ParticipantTile from './ParticipantTile.vue'
import { computeGrid, DEFAULT_GAP, pageSlice } from '~/lib/layout/grid'
import type { ParticipantView } from '~/lib/contracts/call'

const props = defineProps<{ participants: ParticipantView[]; phone: boolean }>()

const container = shallowRef<HTMLElement | null>(null)
const { width, height } = useElementSize(container)
const page = shallowRef(0)

const pagerHeight = computed(() => (props.phone && props.participants.length > 6 ? 40 : 0))
const grid = computed(() =>
  computeGrid({
    count: props.participants.length,
    width: width.value,
    height: Math.max(0, height.value - pagerHeight.value),
    phone: props.phone,
  }),
)
const pages = computed(() => grid.value.pages)
const visible = computed(() => pageSlice(props.participants, page.value, grid.value.pageSize))

watch(pages, (count) => {
  if (page.value > count - 1) page.value = Math.max(0, count - 1)
})

const rowWidth = computed(() => grid.value.cols * grid.value.tileWidth + (grid.value.cols - 1) * DEFAULT_GAP)
</script>

<template>
  <div
    ref="container"
    class="relative flex size-full min-h-0 flex-col"
    data-testid="video-grid"
    :data-cols="grid.cols"
    :data-rows="grid.rows"
  >
    <div class="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
      <div
        class="flex flex-wrap content-center justify-center"
        :style="{ width: `${rowWidth}px`, gap: `${DEFAULT_GAP}px` }"
      >
        <ParticipantTile
          v-for="participant in visible"
          :key="participant.identity"
          :participant="participant"
          :style="{ width: `${grid.tileWidth}px`, height: `${grid.tileHeight}px` }"
        />
      </div>
    </div>
    <nav v-if="pages > 1" aria-label="Pages" class="flex h-10 shrink-0 items-center justify-center gap-3">
      <button
        type="button"
        aria-label="Previous page"
        :disabled="page === 0"
        class="inline-flex size-8 items-center justify-center rounded-full bg-white/10 text-white disabled:opacity-40 max-sm:size-11 pointer-coarse:size-11"
        @click="page = Math.max(0, page - 1)"
      >
        <ChevronLeftIcon class="size-4" aria-hidden="true" />
      </button>
      <span class="flex items-center gap-1.5" aria-live="polite">
        <span
          v-for="index in pages"
          :key="index"
          :class="cn('size-1.5 rounded-full', index - 1 === page ? 'bg-white' : 'bg-white/30')"
          aria-hidden="true"
        />
        <span class="sr-only">Page {{ page + 1 }} of {{ pages }}</span>
      </span>
      <button
        type="button"
        aria-label="Next page"
        :disabled="page >= pages - 1"
        class="inline-flex size-8 items-center justify-center rounded-full bg-white/10 text-white disabled:opacity-40 max-sm:size-11 pointer-coarse:size-11"
        @click="page = Math.min(pages - 1, page + 1)"
      >
        <ChevronRightIcon class="size-4" aria-hidden="true" />
      </button>
    </nav>
  </div>
</template>
