<script setup lang="ts">
/**
 * Control bar from the feature registries (`controlBar` items by placement, `panels` as toggles). On narrow screens
 * everything except Leave scrolls horizontally inside the bar, so the page never overflows and Leave stays reachable.
 * Items with `placement: 'overflow'` render inside the More menu (their root should be a DropdownMenuItem).
 */
import { EllipsisIcon } from '@lucide/vue'
import { useMediaQuery } from '@vueuse/core'
import { computed } from 'vue'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useCall, useCallUi } from '~/composables/call'
import { callRegistry } from '~/lib/call/features'
import { visibleItems } from '~/lib/call/registry'

const LEAVE_ID = 'core.leave'

const ctx = useCall()
const ui = useCallUi()
// Three groups (start · center · end + panels) need about 900 px once every Wave 2 feature registers its controls;
// narrower screens use the single scrolling row, where nothing can overlap.
const wide = useMediaQuery('(min-width: 1024px)')

const items = computed(() => visibleItems(callRegistry.controlBar, ctx))
const leave = computed(() => items.value.find((item) => item.id === LEAVE_ID))
const start = computed(() => items.value.filter((item) => item.placement === 'start'))
const center = computed(() => items.value.filter((item) => item.placement === 'center'))
const end = computed(() => items.value.filter((item) => item.placement === 'end' && item.id !== LEAVE_ID))
const overflow = computed(() => items.value.filter((item) => item.placement === 'overflow'))
const panels = computed(() => visibleItems(callRegistry.panels, ctx))

function badgeOf(panel: (typeof panels.value)[number]): number | undefined {
  try {
    return panel.badge?.(ctx)
  } catch {
    return undefined
  }
}

function togglePanel(id: string) {
  ui.panel.value = ui.panel.value === id ? null : id
}
</script>

<template>
  <footer
    class="relative z-20 flex h-[4.5rem] shrink-0 items-center gap-2 px-2 pb-[env(safe-area-inset-bottom,0px)] sm:px-4"
    data-testid="control-bar"
    aria-label="Call controls"
  >
    <div v-if="wide" class="flex min-w-0 flex-1 items-center gap-2">
      <component :is="item.component" v-for="item in start" :key="item.id" />
    </div>

    <div
      :class="
        cn(
          'flex min-w-0 items-center gap-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          wide ? 'flex-none justify-center' : 'flex-1 overflow-x-auto',
        )
      "
    >
      <template v-if="!wide">
        <component :is="item.component" v-for="item in start" :key="item.id" />
      </template>
      <component :is="item.component" v-for="item in center" :key="item.id" />
      <template v-if="!wide">
        <component :is="item.component" v-for="item in end" :key="item.id" />
      </template>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            aria-label="More options"
            title="More options"
            data-control="more"
            class="inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/18 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <EllipsisIcon class="size-5" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="center" :side-offset="10" class="w-60">
          <template v-if="!wide && panels.length > 0">
            <DropdownMenuItem v-for="panel in panels" :key="panel.id" @select="togglePanel(panel.id)">
              <component :is="panel.icon" aria-hidden="true" />
              {{ panel.title }}
              <span v-if="badgeOf(panel)" class="ml-auto text-xs text-muted-foreground tabular-nums">{{
                badgeOf(panel)
              }}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </template>
          <component :is="item.component" v-for="item in overflow" :key="item.id" />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <div v-if="wide" class="flex min-w-0 flex-1 items-center justify-end gap-2">
      <component :is="item.component" v-for="item in end" :key="item.id" />
      <Tooltip v-for="panel in panels" :key="panel.id" :delay-duration="300">
        <TooltipTrigger as-child>
          <button
            type="button"
            :aria-label="panel.title"
            :aria-pressed="ui.panel.value === panel.id"
            :data-panel="panel.id"
            :class="
              cn(
                'relative inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full px-3 text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                ui.panel.value === panel.id
                  ? 'bg-primary/25 text-primary hover:bg-primary/30'
                  : 'bg-white/10 hover:bg-white/18',
              )
            "
            @click="togglePanel(panel.id)"
          >
            <component :is="panel.icon" class="size-5" aria-hidden="true" />
            <span
              v-if="badgeOf(panel)"
              class="absolute -top-0.5 -right-0.5 min-w-5 rounded-full bg-primary px-1 text-[0.6875rem] leading-5 font-semibold text-primary-foreground tabular-nums"
            >
              {{ badgeOf(panel) }}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" :side-offset="8">{{ panel.title }}</TooltipContent>
      </Tooltip>
    </div>

    <component :is="leave.component" v-if="leave" />
  </footer>
</template>
